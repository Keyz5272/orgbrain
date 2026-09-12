import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

import {
  registerKnowledgeProcessors,
} from "@/lib/knowledge/processors/register";

import {
  processKnowledgeSource,
  resolveProcessor,
} from "@/lib/knowledge/processors/manager";

import type {
  ProcessorContent,
  ProcessorMemory,
  ProcessorContext,
} from "@/lib/knowledge/processors/types";

export async function POST(
  request: NextRequest
) {
  let sourceId: string | null = null;

  try {
    // --------------------------------------------------
    // 1. Authenticate
    // --------------------------------------------------

    registerKnowledgeProcessors();
    const supabase = await createClient();

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

    // --------------------------------------------------
    // 2. Get user's organization
    // --------------------------------------------------

    const {
      data: profile,
      error: profileError,
    } = await supabase
      .from("users")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (
      profileError ||
      !profile?.organization_id
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Organization profile not found.",
        },
        { status: 403 }
      );
    }

    const organizationId =
      profile.organization_id;

    // --------------------------------------------------
    // 3. Read uploaded file
    // --------------------------------------------------

    const formData =
      await request.formData();

    const file =
      formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No file was provided.",
        },
        { status: 400 }
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "The uploaded file is empty.",
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 4. Detect processor and source type
    // --------------------------------------------------

    const {
      processorName,
      sourceType,
    } = resolveProcessor(
      file.name,
      file.type || null
    );

    console.log(
      "ORG BRAIN INGESTION",
      {
        filename: file.name,
        mimeType: file.type,
        processorName,
        sourceType,
      }
    );

    // --------------------------------------------------
    // 5. Create knowledge source
    // --------------------------------------------------

    const {
      data: source,
      error: sourceError,
    } = await supabase
      .from("knowledge_sources")
      .insert({
        organization_id:
          organizationId,

        source_type:
          sourceType,

        filename:
          file.name,

        mime_type:
          file.type || null,

        file_size:
          file.size,

        processing_status:
          "pending",

        uploaded_by:
          user.id,
      })
      .select(
        `
          id,
          organization_id,
          source_type,
          filename,
          mime_type,
          file_size,
          processing_status
        `
      )
      .single();

    if (
      sourceError ||
      !source
    ) {
      console.error(
        "SOURCE CREATE ERROR:",
        sourceError
      );

      return NextResponse.json(
        {
          success: false,
          error:
            sourceError?.message ||
            "Failed to create knowledge source.",
        },
        { status: 500 }
      );
    }

    /*
     * source.id is definitely a string here.
     *
     * We keep this separate from the nullable
     * sourceId variable used by the catch block.
     */
    const createdSourceId =
      source.id;

    sourceId =
      createdSourceId;

    // --------------------------------------------------
    // 6. Create private Storage path
    // --------------------------------------------------

    const extension =
      file.name.includes(".")
        ? "." +
          file.name
            .split(".")
            .pop()
            ?.toLowerCase()
        : "";

    const storagePath =
      `${organizationId}/${crypto.randomUUID()}${extension}`;

    // --------------------------------------------------
    // 7. Convert file to Buffer
    // --------------------------------------------------

    const buffer =
      Buffer.from(
        await file.arrayBuffer()
      );

    // --------------------------------------------------
    // 8. Upload to private knowledge bucket
    // --------------------------------------------------

    const {
      error: storageError,
    } = await supabase.storage
      .from("knowledge")
      .upload(
        storagePath,
        buffer,
        {
          contentType:
            file.type ||
            "application/octet-stream",

          upsert: false,
        }
      );

    if (storageError) {
      console.error(
        "STORAGE UPLOAD ERROR:",
        storageError
      );

      await supabase
        .from("knowledge_sources")
        .update({
          processing_status:
            "failed",

          processing_error:
            storageError.message,
        })
        .eq(
          "id",
          createdSourceId
        );

      return NextResponse.json(
        {
          success: false,
          error:
            "Failed to store the uploaded file.",
        },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // 9. Update source with Storage path
    // --------------------------------------------------

    const {
      error: storagePathError,
    } = await supabase
      .from("knowledge_sources")
      .update({
        storage_path:
          storagePath,

        processing_status:
          "processing",
      })
      .eq(
        "id",
        createdSourceId
      );

    if (storagePathError) {
      throw new Error(
        storagePathError.message
      );
    }

    // --------------------------------------------------
    // 10. Build processor context
    // --------------------------------------------------

    const context: ProcessorContext = {
      sourceId:
        createdSourceId,

      organizationId,

      filename:
        file.name,

      mimeType:
        file.type || null,

      storagePath,
    };

    // --------------------------------------------------
    // 11. Run universal processor
    // --------------------------------------------------

    console.log(
      `PROCESSING ${file.name} WITH ${processorName}`
    );

    const result =
      await processKnowledgeSource(
        context,
        buffer
      );

    // --------------------------------------------------
    // 12. Handle processor failure
    // --------------------------------------------------

    if (!result.success) {
      await supabase
        .from("knowledge_sources")
        .update({
          processing_status:
            "failed",

          processing_error:
            result.error ||
            "Knowledge processing failed.",
        })
        .eq(
          "id",
          createdSourceId
        );

      return NextResponse.json(
        {
          success: false,

          sourceId:
            createdSourceId,

          processor:
            processorName,

          sourceType,

          error:
            result.error ||
            "Knowledge processing failed.",
        },
        { status: 422 }
      );
    }

    // --------------------------------------------------
    // 13. Save processor content
    // --------------------------------------------------

    const contents:
      ProcessorContent[] =
      result.contents ?? [];

    if (contents.length > 0) {
      const contentRows =
        contents.map(
          (
            content: ProcessorContent
          ) => ({
            organization_id:
              organizationId,

            source_id:
              createdSourceId,

            content_type:
              content.content_type,

            content:
              content.content ??
              null,

            structured_data:
              content.structured_data ??
              {},

            page_number:
              content.page_number ??
              null,

            sheet_name:
              content.sheet_name ??
              null,

            row_number:
              content.row_number ??
              null,

            start_timestamp:
              content.start_timestamp ??
              null,

            end_timestamp:
              content.end_timestamp ??
              null,

            section:
              content.section ??
              null,

            content_index:
              content.content_index ??
              null,

            metadata:
              content.metadata ??
              {},
          })
        );

      // ------------------------------------------------
      // Insert content in batches
      // ------------------------------------------------

      const batchSize = 500;

      for (
        let i = 0;
        i < contentRows.length;
        i += batchSize
      ) {
        const batch =
          contentRows.slice(
            i,
            i + batchSize
          );

        const {
          error: contentError,
        } = await supabase
          .from(
            "knowledge_content"
          )
          .insert(batch);

        if (contentError) {
          throw new Error(
            `Failed to save knowledge content: ${contentError.message}`
          );
        }
      }
    }

    // --------------------------------------------------
    // 14. Save extracted memories
    // --------------------------------------------------

    const memories:
      ProcessorMemory[] =
      result.memories ?? [];

    if (memories.length > 0) {
      const memoryRows =
        memories.map(
          (
            memory: ProcessorMemory
          ) => ({
            organization_id:
              organizationId,

            memory_type:
              memory.memory_type,

            title:
              memory.title,

            content:
              memory.content,

            subject:
              memory.subject ??
              null,

            object:
              memory.object ??
              null,

            attributes:
              memory.attributes ??
              {},

            confidence:
              memory.confidence ??
              null,

            status:
              "active",

            source_id:
              createdSourceId,

            /*
             * Content-to-memory linking will
             * be implemented when the memory
             * extraction layer is added.
             */
            source_content_id:
              null,

            created_by:
              user.id,
          })
        );

      const {
        error: memoryError,
      } = await supabase
        .from(
          "knowledge_memories"
        )
        .insert(memoryRows);

      if (memoryError) {
        throw new Error(
          `Failed to save knowledge memories: ${memoryError.message}`
        );
      }
    }

    // --------------------------------------------------
    // 15. Mark source as processed
    // --------------------------------------------------

    const {
      error: completeError,
    } = await supabase
      .from("knowledge_sources")
      .update({
        processing_status:
          "processed",

        processing_error:
          null,
      })
      .eq(
        "id",
        createdSourceId
      );

    if (completeError) {
      throw new Error(
        completeError.message
      );
    }

    // --------------------------------------------------
    // 16. Return successful result
    // --------------------------------------------------

    return NextResponse.json({
      success: true,

      sourceId:
        createdSourceId,

      organizationId,

      filename:
        file.name,

      processor:
        processorName,

      sourceType,

      storagePath,

      contentCount:
        contents.length,

      memoryCount:
        memories.length,

      metadata:
        result.metadata ?? {},
    });
  } catch (error: unknown) {
    console.error(
      "KNOWLEDGE INGESTION ERROR:",
      error
    );

    // --------------------------------------------------
    // Attempt to mark source as failed
    // --------------------------------------------------

    if (sourceId) {
      try {
        const supabase =
          await createClient();

        await supabase
          .from(
            "knowledge_sources"
          )
          .update({
            processing_status:
              "failed",

            processing_error:
              error instanceof Error
                ? error.message
                : "Knowledge ingestion failed.",
          })
          .eq(
            "id",
            sourceId
          );
      } catch (
        updateError
      ) {
        console.error(
          "FAILED TO UPDATE SOURCE STATUS:",
          updateError
        );
      }
    }

    // --------------------------------------------------
    // Return error
    // --------------------------------------------------

    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Knowledge ingestion failed.",
      },
      { status: 500 }
    );
  }
}