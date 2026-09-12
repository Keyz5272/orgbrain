import OpenAI from "openai";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 100;

type KnowledgeItem = {
  id: string;
  source_id: string;
  content: string | null;
  structured_data: Record<string, unknown> | null;
  section: string | null;
  metadata: Record<string, unknown> | null;
};

function buildEmbeddingText(
  item: KnowledgeItem
): string {
  const parts: string[] = [];

  if (item.section) {
    parts.push(`Section: ${item.section}`);
  }

  if (item.content) {
    parts.push(item.content);
  }

  if (
    item.structured_data &&
    Object.keys(item.structured_data).length > 0
  ) {
    parts.push(
      JSON.stringify(item.structured_data)
    );
  }

  return parts.join("\n").trim();
}

export async function POST(request: Request) {
  const supabase = await createClient();

  let sourceId: string | null = null;

  try {
    /*
     * 1. Authenticate
     */
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          success: false,
          error: "Authentication required.",
        },
        { status: 401 }
      );
    }

    /*
     * 2. Get organization
     */
    const {
      data: profile,
      error: profileError,
    } = await supabase
      .from("users")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        {
          success: false,
          error: "User organization not found.",
        },
        { status: 403 }
      );
    }

    const organizationId =
      profile.organization_id;

    /*
     * 3. Optional sourceId
     */
    try {
      const body = await request.json();

      if (
        body &&
        typeof body.sourceId === "string"
      ) {
        sourceId = body.sourceId;
      }
    } catch {
      // Empty request body is allowed.
    }

    /*
     * 4. Processing counters
     */
    let totalProcessed = 0;
    let totalEmbedded = 0;
    let totalFailed = 0;
    let batches = 0;

    /*
     * 5. Keep processing until
     *    no pending records remain.
     */
    while (true) {
      /*
       * Load the next batch of pending
       * knowledge content.
       */
      let query = supabase
        .from("knowledge_content")
        .select(`
          id,
          source_id,
          content,
          structured_data,
          section,
          metadata
        `)
        .eq(
          "organization_id",
          organizationId
        )
        .eq(
          "embedding_status",
          "pending"
        )
        .order("created_at", {
          ascending: true,
        })
        .limit(BATCH_SIZE);

      if (sourceId) {
        query = query.eq(
          "source_id",
          sourceId
        );
      }

      const {
        data: items,
        error: contentError,
      } = await query;

      if (contentError) {
        throw new Error(
          `Failed to load knowledge content: ${contentError.message}`
        );
      }

      /*
       * Nothing left to process.
       */
      if (!items || items.length === 0) {
        break;
      }

      batches++;

      totalProcessed += items.length;

      /*
       * 6. Mark batch as processing
       */
      const itemIds = items.map(
        (item) => item.id
      );

      const {
        error: processingError,
      } = await supabase
        .from("knowledge_content")
        .update({
          embedding_status: "processing",
        })
        .in(
          "id",
          itemIds
        )
        .eq(
          "organization_id",
          organizationId
        );

      if (processingError) {
        await supabase
          .from("knowledge_content")
          .update({
            embedding_status: "failed",
          })
          .in(
            "id",
            itemIds
          )
          .eq(
            "organization_id",
            organizationId
          );

        totalFailed += items.length;

        continue;
      }

      /*
       * 7. Build embedding text
       */
      const prepared =
        (items as KnowledgeItem[]).map(
          (item) => ({
            item,
            text:
              buildEmbeddingText(item),
          })
        );

      const validItems =
        prepared.filter(
          (entry) =>
            entry.text.length > 0
        );

      const invalidItems =
        prepared.filter(
          (entry) =>
            entry.text.length === 0
        );

      /*
       * 8. Mark empty records as failed
       */
      for (
        const entry of invalidItems
      ) {
        await supabase
          .from("knowledge_content")
          .update({
            embedding_status: "failed",
          })
          .eq(
            "id",
            entry.item.id
          )
          .eq(
            "organization_id",
            organizationId
          );
      }

      totalFailed +=
        invalidItems.length;

      /*
       * 9. Generate embeddings
       */
      if (validItems.length === 0) {
        continue;
      }

      try {
        const response =
          await openai.embeddings.create({
            model: EMBEDDING_MODEL,
            input:
              validItems.map(
                (entry) =>
                  entry.text
              ),
          });

        /*
         * 10. Save embeddings
         */
        for (
          let i = 0;
          i < validItems.length;
          i++
        ) {
          const entry =
            validItems[i];

          const embedding =
            response.data[i]
              ?.embedding;

          if (!embedding) {
            totalFailed++;

            await supabase
              .from(
                "knowledge_content"
              )
              .update({
                embedding_status:
                  "failed",
              })
              .eq(
                "id",
                entry.item.id
              )
              .eq(
                "organization_id",
                organizationId
              );

            continue;
          }

          const embeddingString =
            `[${embedding.join(",")}]`;

          const {
            error: updateError,
          } = await supabase
            .from(
              "knowledge_content"
            )
            .update({
              embedding:
                embeddingString,
              embedding_status:
                "embedded",
              embedded_at:
                new Date().toISOString(),
            })
            .eq(
              "id",
              entry.item.id
            )
            .eq(
              "organization_id",
              organizationId
            );

          if (updateError) {
            totalFailed++;

            await supabase
              .from(
                "knowledge_content"
              )
              .update({
                embedding_status:
                  "failed",
              })
              .eq(
                "id",
                entry.item.id
              )
              .eq(
                "organization_id",
                organizationId
              );

            continue;
          }

          totalEmbedded++;
        }
      } catch (
        batchError: unknown
      ) {
        console.error(
          `EMBEDDING BATCH ${batches} ERROR:`,
          batchError
        );

        /*
         * Return this batch to pending so
         * it can safely be retried.
         */
        await supabase
          .from(
            "knowledge_content"
          )
          .update({
            embedding_status:
              "pending",
          })
          .in(
            "id",
            itemIds
          )
          .eq(
            "organization_id",
            organizationId
          );

        throw batchError;
      }

      /*
       * Continue automatically.
       */
    }

    /*
     * 11. Final response
     */
    return NextResponse.json({
      success:
        totalFailed === 0,

      organizationId,

      sourceId,

      processed:
        totalProcessed,

      embedded:
        totalEmbedded,

      failed:
        totalFailed,

      batches,

      model:
        EMBEDDING_MODEL,

      message:
        `Processed ${totalProcessed} knowledge item(s) in ${batches} batch(es): ${totalEmbedded} embedded, ${totalFailed} failed.`,
    });
  } catch (error: unknown) {
    console.error(
      "UNIVERSAL EMBEDDING ERROR:",
      error
    );

    /*
     * If an unexpected error occurs, reset
     * processing records for this source
     * back to pending.
     */
    if (sourceId) {
      await supabase
        .from("knowledge_content")
        .update({
          embedding_status: "pending",
        })
        .eq(
          "source_id",
          sourceId
        )
        .eq(
          "embedding_status",
          "processing"
        );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Universal embedding failed.",
      },
      {
        status: 500,
      }
    );
  }
}