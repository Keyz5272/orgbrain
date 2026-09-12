import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type StructuredRecord = {
  id: string;
  organization_id: string;
  document_id: string;
  record_type: string;
  record_data: Record<string, unknown>;
  row_number: number | null;
  created_at: string;
};

function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeName(value: string) {
  return normalizeSearch(value)
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ");
}

function recordMatches(
  record: StructuredRecord,
  searchTerm: string
) {
  const term = normalizeSearch(searchTerm);

  if (!term) {
    return false;
  }

  const data = record.record_data;

  /*
   * Fields that are especially important for
   * exact structured retrieval.
   */
  const searchableFields = [
    "account_number",
    "account_name",
    "open_date",
    "type",
    "un_cleared_balance",
    "avail_balance",
    "action",
  ];

  for (const field of searchableFields) {
    const value = data[field];

    if (
      value === null ||
      value === undefined
    ) {
      continue;
    }

    const normalizedValue =
      normalizeSearch(
        String(value)
      );

    /*
     * Exact match.
     */
    if (normalizedValue === term) {
      return true;
    }

    /*
     * Partial match.
     */
    if (
      normalizedValue.includes(term)
    ) {
      return true;
    }
  }

  /*
   * Also search all fields so this API
   * remains useful for future spreadsheets.
   */
  for (const value of Object.values(data)) {
    if (
      value === null ||
      value === undefined
    ) {
      continue;
    }

    if (
      normalizeSearch(
        String(value)
      ).includes(term)
    ) {
      return true;
    }
  }

  return false;
}

function calculateMatchScore(
  record: StructuredRecord,
  searchTerm: string
) {
  const term =
    normalizeSearch(searchTerm);

  const data =
    record.record_data;

  let score = 0;

  const accountNumber =
    normalizeSearch(
      String(
        data.account_number ?? ""
      )
    );

  const accountName =
    normalizeName(
      String(
        data.account_name ?? ""
      )
    );

  const type =
    normalizeSearch(
      String(
        data.type ?? ""
      )
    );

  /*
   * Account number is the strongest
   * possible exact match.
   */
  if (
    accountNumber === term
  ) {
    score += 100;
  } else if (
    accountNumber.includes(term)
  ) {
    score += 80;
  }

  /*
   * Account name.
   */
  if (
    accountName ===
    normalizeName(searchTerm)
  ) {
    score += 90;
  } else if (
    accountName.includes(
      normalizeName(searchTerm)
    )
  ) {
    score += 70;
  }

  /*
   * Account type.
   */
  if (
    type === term
  ) {
    score += 40;
  } else if (
    type.includes(term)
  ) {
    score += 20;
  }

  /*
   * General field match.
   */
  for (const value of Object.values(
    data
  )) {
    if (
      value === null ||
      value === undefined
    ) {
      continue;
    }

    const normalizedValue =
      normalizeSearch(
        String(value)
      );

    if (
      normalizedValue === term
    ) {
      score += 30;
    } else if (
      normalizedValue.includes(term)
    ) {
      score += 10;
    }
  }

  return score;
}

export async function POST(
  request: Request
) {
  const supabase =
    await createClient();

  try {
    /* =====================================================
       1. AUTHENTICATION
    ===================================================== */

    const {
      data: {
        user,
      },
      error:
        authError,
    } =
      await supabase.auth.getUser();

    if (
      authError ||
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
       2. GET USER ORGANIZATION
    ===================================================== */

    const {
      data: profile,
      error:
        profileError,
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
      !profile?.organization_id
    ) {
      return NextResponse.json(
        {
          error:
            "Organization profile not found.",
        },
        {
          status: 403,
        }
      );
    }

    const organizationId =
      profile.organization_id;

    /* =====================================================
       3. READ REQUEST
    ===================================================== */

    const body =
      await request.json();

    const searchTerm =
      typeof body.searchTerm ===
      "string"
        ? body.searchTerm.trim()
        : "";

    const recordType =
      typeof body.recordType ===
      "string"
        ? body.recordType.trim()
        : "";

    const documentId =
      typeof body.documentId ===
      "string"
        ? body.documentId.trim()
        : "";

    const limit =
      typeof body.limit ===
      "number"
        ? Math.min(
            Math.max(
              body.limit,
              1
            ),
            100
          )
        : 20;

    if (!searchTerm) {
      return NextResponse.json(
        {
          error:
            "searchTerm is required.",
        },
        {
          status: 400,
        }
      );
    }

    /* =====================================================
       4. LOAD STRUCTURED RECORDS
    ===================================================== */

    let query =
      supabase
        .from(
          "structured_records"
        )
        .select(
          `
          id,
          organization_id,
          document_id,
          record_type,
          record_data,
          row_number,
          created_at
          `
        )
        .eq(
          "organization_id",
          organizationId
        );

    /*
     * Optional record type filter.
     */
    if (recordType) {
      query =
        query.eq(
          "record_type",
          recordType
        );
    }

    /*
     * Optional document filter.
     */
    if (documentId) {
      query =
        query.eq(
          "document_id",
          documentId
        );
    }

    const {
      data: records,
      error:
        recordsError,
    } = await query;

    if (recordsError) {
      console.error(
        "STRUCTURED RECORD QUERY ERROR:",
        recordsError
      );

      throw recordsError;
    }

    /* =====================================================
       5. FILTER RECORDS
    ===================================================== */

    const matchedRecords =
      (
        (records ||
          []) as StructuredRecord[]
      )
        .filter(
          (record) =>
            recordMatches(
              record,
              searchTerm
            )
        )
        .map(
          (record) => ({
            ...record,
            match_score:
              calculateMatchScore(
                record,
                searchTerm
              ),
          })
        )
        .sort(
          (
            a,
            b
          ) =>
            b.match_score -
            a.match_score
        )
        .slice(
          0,
          limit
        );

    /* =====================================================
       6. GET SOURCE DOCUMENT INFORMATION
    ===================================================== */

    const documentIds =
      matchedRecords.map(
        (record) =>
          record.document_id
      );

    let documents:
      Array<{
        id: string;
        filename: string;
        document_type:
          | string
          | null;
        department:
          | string
          | null;
      }> = [];

    if (
      documentIds.length
    ) {
      const {
        data:
          documentRows,
        error:
          documentError,
      } =
        await supabase
          .from("documents")
          .select(
            `
            id,
            filename,
            document_type,
            department
            `
          )
          .in(
            "id",
            documentIds
          );

      if (documentError) {
        throw documentError;
      }

      documents =
        documentRows || [];
    }

    /* =====================================================
       7. ATTACH SOURCE INFORMATION
    ===================================================== */

    const results =
      matchedRecords.map(
        (record) => {
          const document =
            documents.find(
              (item) =>
                item.id ===
                record.document_id
            );

          return {
            id: record.id,

            record_type:
              record.record_type,

            record_data:
              record.record_data,

            row_number:
              record.row_number,

            match_score:
              record.match_score,

            source: {
              document_id:
                record.document_id,

              filename:
                document?.filename ||
                null,

              document_type:
                document?.document_type ||
                null,

              department:
                document?.department ||
                null,

              row_number:
                record.row_number,
            },
          };
        }
      );

    /* =====================================================
       8. RESPONSE
    ===================================================== */

    return NextResponse.json({
      success: true,

      searchTerm,

      organizationId,

      count:
        results.length,

      results,
    });
  } catch (error: unknown) {
    console.error(
      "STRUCTURED RETRIEVAL ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Structured retrieval failed.",
      },
      {
        status: 500,
      }
    );
  }
}