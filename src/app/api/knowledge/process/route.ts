import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { createClient } from "@/lib/supabase/server";

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;
const STRUCTURED_BATCH_SIZE = 500;

/* =========================================================
   FILE TYPE HELPERS
========================================================= */

function isSpreadsheet(filename: string) {
  const lower = filename.toLowerCase();

  return (
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls")
  );
}

/* =========================================================
   TEXT CHUNKING
========================================================= */

function chunkText(text: string) {
  const cleaned = text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const chunks: string[] = [];

  let start = 0;

  while (start < cleaned.length) {
    const end = Math.min(
      start + CHUNK_SIZE,
      cleaned.length
    );

    const chunk = cleaned
      .slice(start, end)
      .trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= cleaned.length) {
      break;
    }

    start = end - CHUNK_OVERLAP;
  }

  return chunks;
}

/* =========================================================
   NORMALIZE SPREADSHEET HEADERS
========================================================= */

function normalizeHeader(
  value: unknown,
  index: number
) {
  const text = String(
    value ?? ""
  ).trim();

  if (!text) {
    return `column_${index + 1}`;
  }

  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/* =========================================================
   FIND ACTUAL HEADER ROW
========================================================= */

function findHeaderRow(
  rows: unknown[][]
) {
  /*
   * These are the kinds of column names
   * expected in the Fiscus account spreadsheet.
   *
   * The parser does NOT assume row 1 is
   * the header anymore.
   */
  const headerKeywords = [
    "account number",
    "account name",
    "open date",
    "type",
    "un-cleared balance",
    "uncleared balance",
    "avail. balance",
    "available balance",
    "action",
  ];

  let bestRow = 0;
  let bestScore = 0;

  rows.forEach(
    (row, rowIndex) => {
      const values = row.map(
        (value) =>
          String(value ?? "")
            .trim()
            .toLowerCase()
      );

      let score = 0;

      for (const value of values) {
        if (
          headerKeywords.some(
            (keyword) =>
              value.includes(keyword)
          )
        ) {
          score++;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestRow = rowIndex;
      }
    }
  );

  return bestRow;
}

/* =========================================================
   EXTRACT NORMAL DOCUMENT TEXT
========================================================= */

async function extractText(
  buffer: Buffer,
  filename: string
) {
  const extension = filename
    .toLowerCase()
    .split(".")
    .pop();

  switch (extension) {
    /* -----------------------------------------------------
       DOCX
    ----------------------------------------------------- */

    case "docx": {
      const result =
        await mammoth.extractRawText({
          buffer,
        });

      return result.value;
    }

    /* -----------------------------------------------------
       TXT / CSV
    ----------------------------------------------------- */

    case "txt":
    case "csv": {
      return buffer.toString(
        "utf-8"
      );
    }

    /* -----------------------------------------------------
       XLSX / XLS
    ----------------------------------------------------- */

    case "xlsx":
    case "xls": {
      const XLSX =
        await import("xlsx");

      const workbook =
        XLSX.read(buffer, {
          type: "buffer",
        });

      const sheets =
        workbook.SheetNames;

      return sheets
        .map(
          (sheetName) => {
            const worksheet =
              workbook.Sheets[
                sheetName
              ];

            return `Sheet: ${sheetName}\n\n${XLSX.utils.sheet_to_csv(
              worksheet
            )}`;
          }
        )
        .join("\n\n");
    }

    /* -----------------------------------------------------
       PDF
    ----------------------------------------------------- */

    case "pdf": {
      const { PDFParse } =
        await import(
          "pdf-parse"
        );

      const parser =
        new PDFParse({
          data: buffer,
        });

      const result =
        await parser.getText();

      await parser.destroy();

      return result.text;
    }

    /* -----------------------------------------------------
       UNSUPPORTED
    ----------------------------------------------------- */

    default:
      throw new Error(
        "Unsupported document type."
      );
  }
}

/* =========================================================
   EXTRACT STRUCTURED SPREADSHEET RECORDS
========================================================= */

async function extractStructuredRecords(
  buffer: Buffer
) {
  const XLSX =
    await import("xlsx");

  const workbook =
    XLSX.read(buffer, {
      type: "buffer",
      cellDates: false,
      raw: false,
    });

  const records: Array<{
    record_type: string;
    record_data: Record<
      string,
      unknown
    >;
    row_number: number;
  }> = [];

  /* -------------------------------------------------------
     PROCESS EVERY SHEET
  ------------------------------------------------------- */

  for (const sheetName of workbook.SheetNames) {
    const worksheet =
      workbook.Sheets[
        sheetName
      ];

    /*
     * First read the spreadsheet as a matrix.
     *
     * Example:
     *
     * Row 1: Account List
     * Row 2: Account Number | Open Date | Account Name...
     * Row 3: 1011000001126 | 2019...
     *
     * This lets us find the real header row.
     */
    const matrix =
      XLSX.utils.sheet_to_json(
        worksheet,
        {
          header: 1,
          defval: null,
          raw: false,
        }
      ) as unknown[][];

    if (!matrix.length) {
      continue;
    }

    /* -----------------------------------------------------
       FIND REAL HEADER
    ----------------------------------------------------- */

    const headerRowIndex =
      findHeaderRow(matrix);

    const headerRow =
      matrix[
        headerRowIndex
      ];

    if (
      !headerRow ||
      !headerRow.length
    ) {
      continue;
    }

    /* -----------------------------------------------------
       NORMALIZE HEADERS
    ----------------------------------------------------- */

    const headers =
      headerRow.map(
        (
          header,
          index
        ) =>
          normalizeHeader(
            header,
            index
          )
      );

    /* -----------------------------------------------------
       PROCESS DATA ROWS
    ----------------------------------------------------- */

    for (
      let rowIndex =
        headerRowIndex + 1;

      rowIndex <
      matrix.length;

      rowIndex++
    ) {
      const row =
        matrix[rowIndex];

      if (!row) {
        continue;
      }

      const recordData: Record<
        string,
        unknown
      > = {};

      /* ---------------------------------------------------
         MAP VALUES TO HEADERS
      --------------------------------------------------- */

      headers.forEach(
        (
          header,
          columnIndex
        ) => {
          recordData[
            header
          ] =
            row[
              columnIndex
            ] ?? null;
        }
      );

      /* ---------------------------------------------------
         IGNORE EMPTY ROWS
      --------------------------------------------------- */

      const hasData =
        Object.values(
          recordData
        ).some(
          (value) =>
            value !==
              null &&
            value !==
              undefined &&
            String(
              value
            ).trim() !== ""
        );

      if (!hasData) {
        continue;
      }

      /* ---------------------------------------------------
         ADD SHEET INFORMATION
      --------------------------------------------------- */

      recordData._sheet =
        sheetName;

      /* ---------------------------------------------------
         STORE RECORD
      --------------------------------------------------- */

      records.push({
        record_type:
          "spreadsheet_row",

        record_data:
          recordData,

        /*
         * XLSX rows are zero-indexed
         * internally, so add 1 to get
         * the real Excel row number.
         */
        row_number:
          rowIndex + 1,
      });
    }
  }

  return records;
}

/* =========================================================
   POST / PROCESS DOCUMENT
========================================================= */

export async function POST(
  request: Request
) {
  const supabase =
    await createClient();

  let documentId:
    | string
    | null = null;

  try {
    /* =====================================================
       1. AUTHENTICATE USER
    ===================================================== */

    const {
      data: {
        user,
      },
      error:
        userError,
    } =
      await supabase.auth.getUser();

    if (
      userError ||
      !user
    ) {
      return NextResponse.json(
        {
          error:
            "Authentication required.",
        },
        {
          status: 401,
        }
      );
    }

    /* =====================================================
       2. READ REQUEST
    ===================================================== */

    const body =
      await request.json();

    documentId =
      typeof body.documentId ===
      "string"
        ? body.documentId
        : null;

    if (!documentId) {
      return NextResponse.json(
        {
          error:
            "documentId is required.",
        },
        {
          status: 400,
        }
      );
    }

    /* =====================================================
       3. LOAD DOCUMENT
    ===================================================== */

    const {
      data: document,
      error:
        documentError,
    } =
      await supabase
        .from("documents")
        .select(
          `
          id,
          filename,
          storage_path,
          organization_id,
          status,
          document_type,
          department
          `
        )
        .eq(
          "id",
          documentId
        )
        .single();

    if (
      documentError ||
      !document
    ) {
      return NextResponse.json(
        {
          error:
            "Document not found.",
        },
        {
          status: 404,
        }
      );
    }

    /* =====================================================
       4. MARK DOCUMENT PROCESSING
    ===================================================== */

    const {
      error:
        processingError,
    } =
      await supabase
        .from("documents")
        .update({
          status:
            "processing",

          /*
           * Processing creates new chunks,
           * therefore embeddings must be recreated.
           */
          embedding_status:
            "pending",
        })
        .eq(
          "id",
          document.id
        );

    if (processingError) {
      throw processingError;
    }

    /* =====================================================
       5. DOWNLOAD PRIVATE FILE
    ===================================================== */

    const {
      data: file,
      error:
        downloadError,
    } =
      await supabase.storage
        .from("knowledge")
        .download(
          document.storage_path
        );

    if (
      downloadError ||
      !file
    ) {
      throw new Error(
        downloadError?.message ||
          "Unable to download document."
      );
    }

    /* =====================================================
       6. CONVERT FILE TO BUFFER
    ===================================================== */

    const arrayBuffer =
      await file.arrayBuffer();

    const buffer =
      Buffer.from(
        arrayBuffer
      );

    /* =====================================================
       7. EXTRACT TEXT
    ===================================================== */

    const extractedText =
      await extractText(
        buffer,
        document.filename
      );

    if (
      !extractedText.trim()
    ) {
      throw new Error(
        "No readable text was found in this document."
      );
    }

    /* =====================================================
       8. CREATE TEXT CHUNKS
    ===================================================== */

    const chunks =
      chunkText(
        extractedText
      );

    if (!chunks.length) {
      throw new Error(
        "Document did not produce any usable chunks."
      );
    }

    /* =====================================================
       9. DETERMINE CONTENT TYPE
    ===================================================== */

    const filename =
      document.filename.toLowerCase();

    let contentType =
      "text";

    if (
      filename.endsWith(
        ".pdf"
      )
    ) {
      contentType =
        "pdf_text";
    } else if (
      filename.endsWith(
        ".docx"
      )
    ) {
      contentType =
        "document_text";
    } else if (
      filename.endsWith(
        ".xlsx"
      ) ||
      filename.endsWith(
        ".xls"
      )
    ) {
      contentType =
        "spreadsheet_text";
    }

    /* =====================================================
       10. DELETE OLD CHUNKS
    ===================================================== */

    const {
      error:
        deleteChunkError,
    } =
      await supabase
        .from(
          "document_chunks"
        )
        .delete()
        .eq(
          "document_id",
          document.id
        );

    if (
      deleteChunkError
    ) {
      throw deleteChunkError;
    }

    /* =====================================================
       11. DELETE OLD STRUCTURED RECORDS
    ===================================================== */

    const {
      error:
        deleteStructuredError,
    } =
      await supabase
        .from(
          "structured_records"
        )
        .delete()
        .eq(
          "document_id",
          document.id
        );

    if (
      deleteStructuredError
    ) {
      throw deleteStructuredError;
    }

    /* =====================================================
       12. PREPARE TEXT CHUNKS
    ===================================================== */

    const chunkRows =
      chunks.map(
        (
          content,
          index
        ) => ({
          document_id:
            document.id,

          content,

          page_number:
            null,

          chunk_index:
            index,

          section:
            "General",

          content_type:
            contentType,

          metadata: {
            source_filename:
              document.filename,

            document_type:
              document.document_type,

            department:
              document.department,

            chunk_index:
              index,
          },
        })
      );

    /* =====================================================
       13. INSERT TEXT CHUNKS
    ===================================================== */

    const {
      error:
        insertChunkError,
    } =
      await supabase
        .from(
          "document_chunks"
        )
        .insert(
          chunkRows
        );

    if (
      insertChunkError
    ) {
      throw insertChunkError;
    }

    /* =====================================================
       14. STRUCTURED SPREADSHEET INGESTION
    ===================================================== */

    let structuredRecordsCreated =
      0;

    if (
      isSpreadsheet(
        document.filename
      )
    ) {
      const structuredRecords =
        await extractStructuredRecords(
          buffer
        );

      /* ---------------------------------------------------
         INSERT STRUCTURED RECORDS
      --------------------------------------------------- */

      if (
        structuredRecords.length >
        0
      ) {
        const structuredRows =
          structuredRecords.map(
            (
              record
            ) => ({
              organization_id:
                document.organization_id,

              document_id:
                document.id,

              record_type:
                record.record_type,

              record_data:
                record.record_data,

              row_number:
                record.row_number,
            })
          );

        /* -------------------------------------------------
           INSERT IN BATCHES
        ------------------------------------------------- */

        for (
          let i = 0;
          i <
          structuredRows.length;
          i +=
            STRUCTURED_BATCH_SIZE
        ) {
          const batch =
            structuredRows.slice(
              i,
              i +
                STRUCTURED_BATCH_SIZE
            );

          const {
            error:
              structuredInsertError,
          } =
            await supabase
              .from(
                "structured_records"
              )
              .insert(
                batch
              );

          if (
            structuredInsertError
          ) {
            throw structuredInsertError;
          }
        }

        structuredRecordsCreated =
          structuredRows.length;
      }
    }

    /* =====================================================
       15. MARK DOCUMENT PROCESSED
    ===================================================== */

    const {
      error:
        updateError,
    } =
      await supabase
        .from("documents")
        .update({
          status:
            "processed",

          /*
           * New chunks have been created,
           * so embeddings must be regenerated.
           */
          embedding_status:
            "pending",
        })
        .eq(
          "id",
          document.id
        );

    if (updateError) {
      throw updateError;
    }

    /* =====================================================
       16. SUCCESS RESPONSE
    ===================================================== */

    return NextResponse.json({
      success: true,

      documentId:
        document.id,

      filename:
        document.filename,

      chunksCreated:
        chunks.length,

      structuredRecordsCreated,

      charactersExtracted:
        extractedText.length,

      status:
        "processed",

      embeddingStatus:
        "pending",
    });
  } catch (error: unknown) {
    /* =====================================================
       ERROR HANDLING
    ===================================================== */

    console.error(
      "DOCUMENT PROCESSING ERROR:",
      error
    );

    /*
     * Safely mark the document as failed.
     */
    if (documentId) {
      try {
        await supabase
          .from("documents")
          .update({
            status:
              "failed",

            embedding_status:
              "failed",
          })
          .eq(
            "id",
            documentId
          );
      } catch (
        statusError
      ) {
        console.error(
          "FAILED TO UPDATE DOCUMENT STATUS:",
          statusError
        );
      }
    }

    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Document processing failed.",
      },
      {
        status: 500,
      }
    );
  }
}