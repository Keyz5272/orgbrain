import OpenAI from "openai";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  verifyEvidence,
  type EvidenceCandidate,
} from "@/lib/knowledge/verification";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const EMBEDDING_MODEL = "text-embedding-3-small";

type VerifyRequest = {
  question?: string;
  limit?: number;
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
    let body: VerifyRequest;

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
     * 4. Limit evidence
     */
    const requestedLimit =
      Number.isInteger(body.limit)
        ? Number(body.limit)
        : 5;

    const limit = Math.min(
      Math.max(requestedLimit, 1),
      20
    );

    /*
     * 5. Create question embedding
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
     * 6. Retrieve universal knowledge
     *
     * Direct RPC call.
     * No internal HTTP request.
     */
    const {
      data: results,
      error: retrievalError,
    } = await supabase.rpc(
      "match_knowledge_content",
      {
        query_embedding:
          queryEmbedding,

        match_count:
          limit,

        match_organization_id:
          organizationId,

        match_source_type:
          null,

        match_content_type:
          null,
      }
    );

    if (retrievalError) {
      throw new Error(
        `Knowledge retrieval failed: ${retrievalError.message}`
      );
    }

    /*
     * 7. Convert results to evidence
     */
    const candidates =
      (results ??
        []) as EvidenceCandidate[];

    /*
     * 8. Verify evidence
     */
    const verification =
      verifyEvidence(
        question,
        candidates
      );

    /*
     * 9. Return complete result
     */
    return NextResponse.json({
      success: true,

      question,

      organizationId,

      retrieval: {
        resultCount:
          candidates.length,

        results:
          candidates,
      },

      verification,
    });
  } catch (error: unknown) {
    console.error(
      "KNOWLEDGE VERIFICATION ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Knowledge verification failed.",
      },
      {
        status: 500,
      }
    );
  }
}