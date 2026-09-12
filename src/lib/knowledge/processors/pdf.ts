// import { getData } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

import type {
  KnowledgeProcessor,
  ProcessorContext,
  ProcessorContent,
  ProcessorResult,
} from "./types";

// PDFParse.setWorker(getData());

/**
 * Clean extracted PDF text.
 */

function cleanText(
  value: string | null | undefined
): string {
  if (!value) {
    return "";
  }

  // Normalize invalid UTF-16 sequences by round-tripping
  // through UTF-8. Invalid characters become U+FFFD.
  const normalized = Buffer
    .from(value, "utf8")
    .toString("utf8");

  return normalized
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // Remove NULL characters, which PostgreSQL does not
    // allow inside JSON/JSONB values.
    .replace(/\u0000/g, "")
    // Remove other problematic control characters while
    // preserving tabs and newlines.
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Process a PDF into page-aware OrgBrain knowledge.
 *
 * Important:
 * Every page is preserved separately so that later
 * answers can cite the exact PDF page.
 */
async function processPdf(
  context: ProcessorContext,
  file: Buffer
): Promise<ProcessorResult> {
  let parser:
    InstanceType<typeof PDFParse> | null =
    null;

  try {
    // --------------------------------------------------
    // 1. Initialize PDF parser
    // --------------------------------------------------

    parser = new PDFParse({
      data: file,
    });

    // --------------------------------------------------
    // 2. Extract page text
    // --------------------------------------------------

    const textResult =
      await parser.getText();

    const contents:
      ProcessorContent[] = [];

    let contentIndex = 0;

    /**
     * pdf-parse exposes the complete text through
     * result.text. We also use getInfo to establish
     * the document/page structure.
     */
    const fullText =
      cleanText(
        textResult.text
      );

    // --------------------------------------------------
    // 3. Get PDF information
    // --------------------------------------------------

    const infoResult =
      await parser.getInfo({
        parsePageInfo: true,
      });

    const totalPages =
      infoResult.total ?? 0;

    // --------------------------------------------------
    // 4. Extract each page separately
    // --------------------------------------------------

    if (totalPages > 0) {
      for (
        let pageNumber = 1;
        pageNumber <= totalPages;
        pageNumber++
      ) {
        /**
         * Parse one page at a time.
         *
         * This gives OrgBrain an explicit page boundary
         * instead of treating the entire PDF as one blob.
         */
        const pageResult =
          await parser.getText({
            partial: [
              pageNumber,
            ],
          });

        const pageText =
          cleanText(
            pageResult.text
          );

        if (!pageText) {
          continue;
        }

        contents.push({
          content_type:
            "text",

          content:
            pageText,

          page_number:
            pageNumber,

          content_index:
            contentIndex++,

          metadata: {
            source_id:
              context.sourceId,

            filename:
              context.filename,

            processor:
              "pdf",

            page:
              pageNumber,

            total_pages:
              totalPages,
          },
        });
      }
    }

    /**
     * Fallback for PDFs where page information
     * cannot be determined.
     */
    if (
      contents.length === 0 &&
      fullText
    ) {
      contents.push({
        content_type:
          "text",

        content:
          fullText,

        page_number:
          null,

        content_index:
          contentIndex++,

        metadata: {
          source_id:
            context.sourceId,

          filename:
            context.filename,

          processor:
            "pdf",

          fallback:
            true,
        },
      });
    }

    // --------------------------------------------------
    // 5. Return normalized PDF knowledge
    // --------------------------------------------------

    return {
      success: true,

      source_type:
        "pdf",

      contents,

      memories: [],

      metadata: {
        processor:
          "pdf",

        filename:
          context.filename,

        page_count:
          totalPages,

        content_count:
          contents.length,

        text_length:
          fullText.length,

        title:
  infoResult.info?.Title ??
  null,

author:
  infoResult.info?.Author ??
  null,

creator:
  infoResult.info?.Creator ??
  null,

producer:
  infoResult.info?.Producer ??
  null,

creation_date:
  infoResult.info?.CreationDate ??
  null,

modification_date:
  infoResult.info?.ModDate ??
  null,

        page_info:
          infoResult.pages ?? [],
      },
    };
  } catch (error: unknown) {
    console.error(
      "PDF PROCESSOR ERROR:",
      error
    );

    return {
      success: false,

      source_type:
        "pdf",

      contents: [],

      memories: [],

      error:
        error instanceof Error
          ? error.message
          : "PDF processing failed.",
    };
  } finally {
    // Always release parser resources.
    if (parser) {
      await parser.destroy();
    }
  }
}

/**
 * OrgBrain PDF Processor
 */
export const pdfProcessor:
  KnowledgeProcessor = {
  name: "pdf",

  supportedSourceTypes: [
    "pdf",
  ],

  process:
    processPdf,
};