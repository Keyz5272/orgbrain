import OpenAI from "openai";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const EMBEDDING_MODEL = "text-embedding-3-small";

type RetrieveRequest = {
  question?: string;
  limit?: number;
  sourceType?: string | null;
  contentType?: string | null;
};

export async function POST(request: Request) {
  const supabase = await createClient();

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
     * 3. Read request
     */
    let body: RetrieveRequest;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON request.",
        },
        { status: 400 }
      );
    }

    const question =
      typeof body.question === "string"
        ? body.question.trim()
        : "";

    if (!question) {
      return NextResponse.json(
        {
          success: false,
          error: "Question is required.",
        },
        { status: 400 }
      );
    }

    /*
     * 4. Limit results
     */
    const requestedLimit =
      Number.isInteger(body.limit)
        ? Number(body.limit)
        : 10;

    const limit = Math.min(
      Math.max(requestedLimit, 1),
      50
    );

    /*
     * 5. Optional filters
     */
    const sourceType =
      typeof body.sourceType === "string" &&
      body.sourceType.trim()
        ? body.sourceType.trim()
        : null;

    const contentType =
      typeof body.contentType === "string" &&
      body.contentType.trim()
        ? body.contentType.trim()
        : null;

    /*
     * 6. Create question embedding
     */
    const embeddingResponse =
      await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: question,
      });

    const queryEmbedding =
      embeddingResponse.data[0]?.embedding;

    if (!queryEmbedding) {
      throw new Error(
        "Failed to create question embedding."
      );
    }

    /*
     * 7. Search universal knowledge
     */
    const {
      data: results,
      error: retrievalError,
    } = await supabase.rpc(
      "match_knowledge_content",
      {
        query_embedding: queryEmbedding,
        match_count: limit,
        match_organization_id:
          organizationId,
        match_source_type:
          sourceType,
        match_content_type:
          contentType,
      }
    );

    if (retrievalError) {
      throw new Error(
        `Knowledge retrieval failed: ${retrievalError.message}`
      );
    }

    /*
     * 8. Return ranked evidence
     */
    return NextResponse.json({
      success: true,

      question,

      organizationId,

      model: EMBEDDING_MODEL,

      filters: {
        sourceType,
        contentType,
        limit,
      },

      resultCount:
        results?.length ?? 0,

      results:
        results ?? [],
    });
  } catch (error: unknown) {
    console.error(
      "UNIVERSAL RETRIEVAL ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Universal knowledge retrieval failed.",
      },
      {
        status: 500,
      }
    );
  }
}