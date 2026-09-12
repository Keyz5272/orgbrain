import * as XLSX from "xlsx";

import type {
  KnowledgeProcessor,
  ProcessorContext,
  ProcessorResult,
  ProcessorContent,
} from "./types";

/**
 * Normalize spreadsheet headers.
 *
 * Example:
 * "Account Number" -> "account_number"
 * "Available Balance" -> "available_balance"
 */
function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-\/]+/g, "_")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Clean spreadsheet cell values before storing them.
 */
function cleanValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const cleaned = value.trim();

    return cleaned === "" ? null : cleaned;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return String(value);
}

/**
 * Detect the row containing the spreadsheet headers.
 *
 * We inspect the first 30 rows and select the row
 * containing the strongest set of business/data keywords.
 */
function findHeaderRow(
  rows: unknown[][]
): number {
  const maxRows = Math.min(rows.length, 30);

  const headerKeywords = [
    "account",
    "account number",
    "account name",
    "customer",
    "customer name",
    "staff",
    "employee",
    "name",
    "amount",
    "balance",
    "date",
    "type",
    "action",
    "department",
    "contact",
    "location",
    "description",
    "code",
    "id",
  ];

  let bestRow = 0;
  let bestScore = -1;

  for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
    const row = rows[rowIndex] ?? [];

    const values = row
      .map((value) =>
        String(value ?? "")
          .trim()
          .toLowerCase()
      )
      .filter(Boolean);

    if (values.length === 0) {
      continue;
    }

    let score = 0;

    for (const value of values) {
      for (const keyword of headerKeywords) {
        if (
          value === keyword ||
          value.includes(keyword)
        ) {
          score += 1;
          break;
        }
      }
    }

    /**
     * Header rows normally contain multiple non-empty
     * cells. Give them a small additional score.
     */
    if (values.length >= 2) {
      score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestRow = rowIndex;
    }
  }

  return bestRow;
}

/**
 * Ensure every header is unique.
 *
 * Example:
 * account -> account
 * account -> account_2
 */
function makeUniqueHeaders(
  headers: string[]
): string[] {
  const counts = new Map<string, number>();

  return headers.map((header, index) => {
    let base =
      header ||
      `column_${index + 1}`;

    const count =
      counts.get(base) ?? 0;

    counts.set(base, count + 1);

    if (count === 0) {
      return base;
    }

    return `${base}_${count + 1}`;
  });
}

/**
 * Determine whether a row is completely empty.
 */
function isEmptyRow(
  row: unknown[]
): boolean {
  return row.every(
    (value) =>
      value === null ||
      value === undefined ||
      String(value).trim() === ""
  );
}

/**
 * Convert a spreadsheet into OrgBrain's universal
 * knowledge representation.
 *
 * Spreadsheet-specific information is preserved:
 * - sheet
 * - header row
 * - actual source row
 * - structured row data
 * - table representation
 */
async function processSpreadsheet(
  context: ProcessorContext,
  file: Buffer
): Promise<ProcessorResult> {
  try {
    /**
     * Read workbook directly using XLSX.
     *
     * cellDates ensures Excel date cells are returned
     * as JavaScript Date objects where possible.
     */
    const workbook = XLSX.read(file, {
      type: "buffer",
      cellDates: true,
    });

    const contents: ProcessorContent[] = [];

    let globalIndex = 0;

    /**
     * Process every worksheet independently.
     */
    for (const sheetName of workbook.SheetNames) {
      const worksheet =
        workbook.Sheets[sheetName];

      if (!worksheet) {
        continue;
      }

      /**
       * Read worksheet as a raw 2D array.
       *
       * header: 1 means XLSX returns:
       *
       * [
       *   ["Name", "Age", "Department"],
       *   ["John", 25, "IT"]
       * ]
       */
      const rows =
        XLSX.utils.sheet_to_json(
          worksheet,
          {
            header: 1,
            defval: null,
            raw: true,
          }
        ) as unknown[][];

      if (rows.length === 0) {
        continue;
      }

      /**
       * Find the real header row.
       */
      const headerRowIndex =
        findHeaderRow(rows);

      const rawHeaders =
        rows[headerRowIndex] ?? [];

      const normalizedHeaders =
        rawHeaders.map(
          normalizeHeader
        );

      const headers =
        makeUniqueHeaders(
          normalizedHeaders
        );

      /**
       * Ignore completely empty headers.
       *
       * If a spreadsheet has:
       *
       * Name | Age | Department | [empty]
       *
       * the empty column will not become part of
       * the structured record.
       */
      const validHeaderIndexes =
        headers
          .map((header, index) => ({
            header,
            index,
          }))
          .filter(
            ({ header }) =>
              header.length > 0
          );

      /**
       * Add a table-level knowledge content item.
       *
       * This allows OrgBrain to understand the overall
       * structure of the worksheet.
       */
      contents.push({
        content_type: "table",

        content: headers
          .filter(Boolean)
          .join(" | "),

        structured_data: {
          sheet_name: sheetName,

          headers: headers.filter(
            Boolean
          ),

          header_row:
            headerRowIndex + 1,

          total_rows:
            Math.max(
              rows.length -
                headerRowIndex -
                1,
              0
            ),
        },

        sheet_name: sheetName,

        content_index:
          globalIndex++,

        metadata: {
          source_id:
            context.sourceId,

          filename:
            context.filename,

          processor:
            "spreadsheet",

          header_row:
            headerRowIndex + 1,
        },
      });

      /**
       * Process each data row after the header.
       */
      for (
        let rowIndex =
          headerRowIndex + 1;
        rowIndex < rows.length;
        rowIndex++
      ) {
        const row =
          rows[rowIndex] ?? [];

        /**
         * Skip completely empty rows.
         */
        if (isEmptyRow(row)) {
          continue;
        }

        const structuredData:
          Record<string, unknown> = {};

        /**
         * Preserve spreadsheet-specific metadata.
         */
        structuredData._sheet =
          sheetName;

        /**
         * Excel/source row number is 1-based.
         */
        structuredData._source_row =
          rowIndex + 1;

        /**
         * Map every spreadsheet column
         * into its normalized field name.
         */
        for (const {
          header,
          index,
        } of validHeaderIndexes) {
          structuredData[header] =
            cleanValue(row[index]);
        }

        /**
         * Build a human-readable representation
         * for semantic retrieval.
         */
        const textParts =
          validHeaderIndexes
            .map(
              ({
                header,
              }) => {
                const value =
                  structuredData[
                    header
                  ];

                if (
                  value === null ||
                  value === undefined ||
                  value === ""
                ) {
                  return null;
                }

                return `${header}: ${String(
                  value
                )}`;
              }
            )
            .filter(
              (
                value
              ): value is string =>
                Boolean(value)
            );

        const content =
          textParts.join(" | ");

        /**
         * Store the row as structured knowledge.
         */
        contents.push({
          content_type: "row",

          content,

          structured_data:
            structuredData,

          sheet_name:
            sheetName,

          row_number:
            rowIndex + 1,

          content_index:
            globalIndex++,

          metadata: {
            source_id:
              context.sourceId,

            filename:
              context.filename,

            processor:
              "spreadsheet",

            sheet:
              sheetName,

            header_row:
              headerRowIndex + 1,

            source_row:
              rowIndex + 1,
          },
        });
      }
    }

    /**
     * Successful processing result.
     */
    return {
      success: true,

      source_type:
        "spreadsheet",

      contents,

      memories: [],

      metadata: {
        processor:
          "spreadsheet",

        filename:
          context.filename,

        sheets:
          workbook.SheetNames,

        sheet_count:
          workbook.SheetNames.length,

        content_count:
          contents.length,
      },
    };
  } catch (error: unknown) {
    console.error(
      "SPREADSHEET PROCESSOR ERROR:",
      error
    );

    return {
      success: false,

      source_type:
        "spreadsheet",

      contents: [],

      memories: [],

      error:
        error instanceof Error
          ? error.message
          : "Spreadsheet processing failed.",
    };
  }
}

/**
 * OrgBrain Spreadsheet Processor
 */
export const spreadsheetProcessor:
  KnowledgeProcessor = {
  name: "spreadsheet",

  supportedSourceTypes: [
    "spreadsheet",
  ],

  process:
    processSpreadsheet,
};