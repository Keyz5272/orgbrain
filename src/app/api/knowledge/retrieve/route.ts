import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  const supabase = await createClient();

  try {
    // 1. Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          error: "Authentication required.",
        },
        { status: 401 }
      );
    }

    // 2. Get the user's organization
    const { data: profile, error: profileError } =
      await supabase
        .from("users")
        .select("organization_id")
        .eq("id", user.id)
        .single();

    if (profileError || !profile?.organization_id) {
      return NextResponse.json(
        {
          error: "Organization profile not found.",
        },
        { status: 403 }
      );
    }

    const organizationId = profile.organization_id;

    // 3. Read the question
    const body = await request.json();

    const question =
      typeof body.question === "string"
        ? body.question.trim()
        : "";

    if (!question) {
      return NextResponse.json(
        {
          error: "Question is required.",
        },
        { status: 400 }
      );
    }

    // 4. Convert the question into an embedding
    const embeddingResponse =
      await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: question,
      });

    const queryEmbedding =
      embeddingResponse.data[0].embedding;

    // 5. Search only this organization's knowledge
    const { data: matches, error: searchError } =
      await supabase.rpc(
        "match_document_chunks",
        {
          query_embedding: queryEmbedding,
          match_count: 5,
          match_organization_id: organizationId,
        }
      );

    if (searchError) {
      console.error("VECTOR SEARCH ERROR:", searchError);

      throw searchError;
    }

    // 6. Return retrieved evidence
    return NextResponse.json({
      success: true,
      question,
      organizationId,
      results: matches || [],
    });
  } catch (error: unknown) {
    console.error("RETRIEVAL ERROR:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Retrieval failed.",
      },
      { status: 500 }
    );
  }
}