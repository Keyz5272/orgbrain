import mammoth from "mammoth";

import type {
  KnowledgeProcessor,
  ProcessorContext,
  ProcessorContent,
  ProcessorResult,
} from "./types";

/**
 * Clean extracted text.
 */
function cleanText(
  value: string | null | undefined
): string {
  return (value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Remove HTML tags while preserving readable text.
 */
function stripHtml(
  html: string
): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract the text contained inside an HTML element.
 */
function extractElementText(
  html: string
): string {
  return cleanText(
    stripHtml(html)
  );
}

/**
 * Extract headings from Mammoth-generated HTML.
 */
function extractHeadings(
  html: string
): Array<{
  level: number;
  text: string;
  position: number;
}> {
  const headings: Array<{
    level: number;
    text: string;
    position: number;
  }> = [];

  const headingRegex =
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;

  let match: RegExpExecArray | null;

  while (
    (match =
      headingRegex.exec(html)) !== null
  ) {
    const level =
      Number(match[1]);

    const text =
      extractElementText(
        match[2]
      );

    if (!text) {
      continue;
    }

    headings.push({
      level,
      text,
      position: match.index,
    });
  }

  return headings;
}

/**
 * Extract paragraphs from Mammoth-generated HTML.
 */
function extractParagraphs(
  html: string
): Array<{
  text: string;
  position: number;
}> {
  const paragraphs: Array<{
    text: string;
    position: number;
  }> = [];

  const paragraphRegex =
    /<p[^>]*>([\s\S]*?)<\/p>/gi;

  let match: RegExpExecArray | null;

  while (
    (match =
      paragraphRegex.exec(html)) !== null
  ) {
    const text =
      extractElementText(
        match[1]
      );

    if (!text) {
      continue;
    }

    paragraphs.push({
      text,
      position: match.index,
    });
  }

  return paragraphs;
}

/**
 * Extract HTML tables.
 *
 * We intentionally keep table structure because
 * organizational documents often contain:
 *
 * - employee lists
 * - financial information
 * - approval matrices
 * - policies
 * - schedules
 * - contact information
 */
function extractTables(
  html: string
): Array<{
  headers: string[];
  rows: string[][];
  text: string;
  position: number;
}> {
  const tables: Array<{
    headers: string[];
    rows: string[][];
    text: string;
    position: number;
  }> = [];

  const tableRegex =
    /<table[^>]*>([\s\S]*?)<\/table>/gi;

  let tableMatch: RegExpExecArray | null;

  while (
    (tableMatch =
      tableRegex.exec(html)) !== null
  ) {
    const tableHtml =
      tableMatch[1];

    const rows: string[][] = [];

    const rowRegex =
      /<tr[^>]*>([\s\S]*?)<\/tr>/gi;

    let rowMatch: RegExpExecArray | null;

    while (
      (rowMatch =
        rowRegex.exec(
          tableHtml
        )) !== null
    ) {
      const rowHtml =
        rowMatch[1];

      const cells: string[] = [];

      const cellRegex =
        /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;

      let cellMatch: RegExpExecArray | null;

      while (
        (cellMatch =
          cellRegex.exec(
            rowHtml
          )) !== null
      ) {
        cells.push(
          extractElementText(
            cellMatch[1]
          )
        );
      }

      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    if (rows.length === 0) {
      continue;
    }

    const headers =
      rows[0] ?? [];

    const dataRows =
      rows.slice(1);

    const text =
      rows
        .map(
          (row) =>
            row.join(" | ")
        )
        .join("\n");

    tables.push({
      headers,
      rows: dataRows,
      text,
      position:
        tableMatch.index,
    });
  }

  return tables;
}

/**
 * Convert a table into structured records.
 */
function buildTableRecords(
  headers: string[],
  rows: string[][]
): Record<
  string,
  unknown
>[] {
  return rows.map(
    (row) => {
      const record:
        Record<string, unknown> =
        {};

      headers.forEach(
        (header, index) => {
          const key =
            header
              .trim()
              .toLowerCase()
              .replace(
                /[\s\-\/]+/g,
                "_"
              )
              .replace(
                /[^\w]+/g,
                "_"
              )
              .replace(
                /^_+|_+$/g,
                ""
              );

          if (!key) {
            return;
          }

          record[key] =
            row[index] ?? null;
        }
      );

      return record;
    }
  );
}

/**
 * Process a DOCX document into OrgBrain knowledge.
 */
async function processDocument(
  context: ProcessorContext,
  file: Buffer
): Promise<ProcessorResult> {
  try {
    // --------------------------------------------------
    // 1. Extract raw text
    // --------------------------------------------------

    const rawTextResult =
      await mammoth.extractRawText({
        buffer: file,
      });

    const rawText =
      cleanText(
        rawTextResult.value
      );

    // --------------------------------------------------
    // 2. Convert DOCX to HTML
    //
    // Mammoth gives us structural information such as
    // headings and tables through the generated HTML.
    // --------------------------------------------------

    const htmlResult =
      await mammoth.convertToHtml({
        buffer: file,
      });

    const html =
      htmlResult.value;

    const contents:
      ProcessorContent[] = [];

    let contentIndex = 0;

    // --------------------------------------------------
    // 3. Extract headings
    // --------------------------------------------------

    const headings =
      extractHeadings(html);

    for (
      const heading of headings
    ) {
      contents.push({
        content_type:
          "heading",

        content:
          heading.text,

        section:
          heading.text,

        content_index:
          contentIndex++,

        metadata: {
          source_id:
            context.sourceId,

          filename:
            context.filename,

          processor:
            "document",

          heading_level:
            heading.level,

          position:
            heading.position,
        },
      });
    }

    // --------------------------------------------------
    // 4. Extract paragraphs
    // --------------------------------------------------

    const paragraphs =
      extractParagraphs(html);

    /**
     * Determine the section associated with a paragraph.
     *
     * We use the nearest preceding heading.
     */
    for (
      const paragraph of paragraphs
    ) {
      let section:
        string | null =
        null;

      for (
        const heading of headings
      ) {
        if (
          heading.position <
          paragraph.position
        ) {
          section =
            heading.text;
        } else {
          break;
        }
      }

      contents.push({
        content_type:
          "text",

        content:
          paragraph.text,

        section,

        content_index:
          contentIndex++,

        metadata: {
          source_id:
            context.sourceId,

          filename:
            context.filename,

          processor:
            "document",

          position:
            paragraph.position,
        },
      });
    }

    // --------------------------------------------------
    // 5. Extract tables
    // --------------------------------------------------

    const tables =
      extractTables(html);

    for (
      let tableIndex = 0;
      tableIndex <
      tables.length;
      tableIndex++
    ) {
      const table =
        tables[tableIndex];

      const structuredRows =
        buildTableRecords(
          table.headers,
          table.rows
        );

      contents.push({
        content_type:
          "table",

        content:
          table.text,

        structured_data: {
          table_index:
            tableIndex,

          headers:
            table.headers,

          rows:
            structuredRows,
        },

        content_index:
          contentIndex++,

        metadata: {
          source_id:
            context.sourceId,

          filename:
            context.filename,

          processor:
            "document",

          table_index:
            tableIndex,

          row_count:
            table.rows.length,

          position:
            table.position,
        },
      });

      /**
       * Also preserve individual table rows.
       *
       * This allows future retrieval to answer
       * questions about a specific row without
       * requiring the entire table.
       */
      for (
        let rowIndex = 0;
        rowIndex <
        table.rows.length;
        rowIndex++
      ) {
        const row =
          table.rows[rowIndex];

        const rowData:
          Record<string, unknown> =
          structuredRows[rowIndex] ??
          {};

        contents.push({
          content_type:
            "row",

          content:
            row.join(" | "),

          structured_data:
            rowData,

          row_number:
            rowIndex + 1,

          content_index:
            contentIndex++,

          metadata: {
            source_id:
              context.sourceId,

            filename:
              context.filename,

            processor:
              "document",

            table_index:
              tableIndex,

            table_row:
              rowIndex + 1,
          },
        });
      }
    }

    // --------------------------------------------------
    // 6. Fallback
    //
    // Some DOCX files may produce useful raw text but
    // little or no HTML structure.
    // --------------------------------------------------

    if (
      contents.length === 0 &&
      rawText
    ) {
      contents.push({
        content_type:
          "text",

        content:
          rawText,

        content_index:
          contentIndex++,

        metadata: {
          source_id:
            context.sourceId,

          filename:
            context.filename,

          processor:
            "document",

          fallback:
            true,
        },
      });
    }

    // --------------------------------------------------
    // 7. Return normalized result
    // --------------------------------------------------

    return {
      success: true,

      source_type:
        "document",

      contents,

      memories: [],

      metadata: {
        processor:
          "document",

        filename:
          context.filename,

        paragraph_count:
          paragraphs.length,

        heading_count:
          headings.length,

        table_count:
          tables.length,

        content_count:
          contents.length,

        raw_text_length:
          rawText.length,

        mammoth_messages:
          htmlResult.messages,
      },
    };
  } catch (error: unknown) {
    console.error(
      "DOCUMENT PROCESSOR ERROR:",
      error
    );

    return {
      success: false,

      source_type:
        "document",

      contents: [],

      memories: [],

      error:
        error instanceof Error
          ? error.message
          : "Document processing failed.",
    };
  }
}

/**
 * OrgBrain Document Processor
 */
export const documentProcessor:
  KnowledgeProcessor = {
  name: "document",

  supportedSourceTypes: [
    "document",
  ],

  process:
    processDocument,
};