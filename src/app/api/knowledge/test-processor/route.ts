import { NextRequest, NextResponse } from "next/server";

import {
  processKnowledgeSource,
} from "@/lib/knowledge/processors/manager";

import {
  registerKnowledgeProcessors,
} from "@/lib/knowledge/processors/register";

import type {
  ProcessorContext,
} from "@/lib/knowledge/processors/types";

import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest
) {
  try {
    // Register available processors
    registerKnowledgeProcessors();

    // Authenticate user
    const supabase =
  await createClient();

    const {
      data: {
        user,
      },
      error: authError,
    } =
      await supabase.auth.getUser();

    if (
      authError ||
      !user
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Authentication required.",
        },
        {
          status: 401,
        }
      );
    }

    // Get uploaded file
    const formData =
      await request.formData();

    const file =
      formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No file provided.",
        },
        {
          status: 400,
        }
      );
    }

    // Get user's organization
    const {
      data: profile,
      error: profileError,
    } =
      await supabase
        .from("users")
        .select(
          "organization_id"
        )
        .eq(
          "id",
          user.id
        )
        .single();

    if (
      profileError ||
      !profile
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Organization profile not found.",
        },
        {
          status: 403,
        }
      );
    }

    // Convert uploaded file to Buffer
    const arrayBuffer =
      await file.arrayBuffer();

    const buffer =
      Buffer.from(arrayBuffer);

    // Temporary source ID for processor testing
    const sourceId =
      crypto.randomUUID();

    const context:
      ProcessorContext = {
      sourceId,

      organizationId:
        profile.organization_id,

      filename:
        file.name,

      mimeType:
        file.type || null,

      storagePath:
        "",
    };

    // Process using universal processor manager
    const result =
      await processKnowledgeSource(
        context,
        buffer
      );

    return NextResponse.json({
      success:
        result.success,

      processor:
        "spreadsheet",

      sourceType:
        result.source_type,

      filename:
        file.name,

      contentCount:
        result.contents.length,

      memoryCount:
        result.memories?.length ?? 0,

      metadata:
        result.metadata ?? {},

      contents:
        result.contents,

      memories:
        result.memories ?? [],

      error:
        result.error ?? null,
    });
  } catch (error: unknown) {
    console.error(
      "TEST PROCESSOR ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Processor test failed.",
      },
      {
        status: 500,
      }
    );
  }
}