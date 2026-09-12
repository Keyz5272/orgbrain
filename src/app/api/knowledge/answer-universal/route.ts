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

const EMBEDDING_MODEL =
  "text-embedding-3-small";

const ANSWER_MODEL =
  "gpt-5.6-luna";

type AnswerRequest = {
  question?: string;
  limit?: number;
};

type EvidenceForAnswer = {
  source: EvidenceCandidate;

  citation: {
    filename: string | null;
    page: number | null;
    sheet: string | null;
    row: number | null;
    startTimestamp: number | null;
    endTimestamp: number | null;
  };
};

/* =========================================================
   NORMALIZATION
========================================================= */

function normalize(
  value: string | null | undefined
): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   EXACT LOOKUP DETECTION
========================================================= */

function isExactLookupQuestion(
  question: string
): boolean {
  return /\b(account number|account|balance|available balance|uncleared balance|contact|phone number|telephone|employee id|customer id|open date)\b/i.test(
    question
  );
}

/* =========================================================
   ENTITY EXTRACTION
========================================================= */

function extractEntity(
  question: string
): string | null {
  const normalized =
    normalize(question);

  /*
   * Example:
   *
   * What is the account number of Josephine Osae?
   *
   * → josephine osae
   */

  const ofMatch =
    normalized.match(
      /\b(?:of|for)\s+(.+)$/
    );

  if (ofMatch?.[1]) {
    const entity =
      ofMatch[1]
        .replace(
          /\b(account|number|balance|available|uncleared|contact|phone|telephone|employee|customer|id|open|date)\b/g,
          " "
        )
        .replace(/\s+/g, " ")
        .trim();

    if (
      entity.length >= 3 &&
      entity.split(/\s+/).length <= 8
    ) {
      return entity;
    }
  }

  /*
   * Example:
   *
   * What is Josephine Osae's account number?
   */

  const possessiveMatch =
    normalized.match(
      /\bwhat(?:'s| is)\s+(.+?)\s+(?:account number|account|balance|available balance|uncleared balance|contact|phone number|telephone|employee id|customer id|open date)\b/
    );

  if (possessiveMatch?.[1]) {
    const entity =
      possessiveMatch[1]
        .replace(
          /\bthe\b/g,
          " "
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    if (
      entity.length >= 3 &&
      entity.split(/\s+/).length <= 8
    ) {
      return entity;
    }
  }

  return null;
}

/* =========================================================
   GET REQUESTED FIELD
========================================================= */

function getRequestedField(
  question: string
): string | null {
  const normalized =
    normalize(question);

  if (
    normalized.includes(
      "account number"
    )
  ) {
    return "account_number";
  }

  if (
    normalized.includes(
      "available balance"
    )
  ) {
    return "avail_balance";
  }

  if (
    normalized.includes(
      "uncleared balance"
    )
  ) {
    return "un_cleared_balance";
  }

  if (
    normalized.includes(
      "balance"
    )
  ) {
    return "avail_balance";
  }

  if (
    normalized.includes(
      "phone number"
    ) ||
    normalized.includes(
      "telephone"
    ) ||
    normalized.includes(
      "contact"
    )
  ) {
    return "contact";
  }

  if (
    normalized.includes(
      "open date"
    )
  ) {
    return "open_date";
  }

  if (
    normalized.includes(
      "employee id"
    )
  ) {
    return "employee_id";
  }

  if (
    normalized.includes(
      "customer id"
    )
  ) {
    return "customer_id";
  }

  return null;
}

/* =========================================================
   BUILD EVIDENCE CONTEXT
========================================================= */

function buildEvidenceContext(
  evidence: EvidenceCandidate,
  supportingEvidence: EvidenceCandidate[]
): EvidenceForAnswer[] {
  const allEvidence = [
    evidence,
    ...supportingEvidence,
  ];

  /*
   * Remove duplicates.
   */
  const uniqueEvidence =
    Array.from(
      new Map(
        allEvidence.map(
          (item) => [
            item.id,
            item,
          ]
        )
      ).values()
    );

  return uniqueEvidence.map(
    (item) => ({
      source: item,

      citation: {
        filename:
          item.filename,

        page:
          item.page_number,

        sheet:
          item.sheet_name,

        row:
          item.row_number,

        startTimestamp:
          item.start_timestamp,

        endTimestamp:
          item.end_timestamp,
      },
    })
  );
}

/* =========================================================
   BUILD ANSWER PROMPT
========================================================= */

function buildAnswerPrompt(
  question: string,
  evidenceItems: EvidenceForAnswer[]
): string {
  const evidenceText =
    evidenceItems
      .map((item, index) => {
        const source =
          item.source;

        const locationParts: string[] =
          [];

        if (
          source.page_number !==
          null
        ) {
          locationParts.push(
            `Page ${source.page_number}`
          );
        }

        if (source.sheet_name) {
          locationParts.push(
            `Sheet ${source.sheet_name}`
          );
        }

        if (
          source.row_number !==
          null
        ) {
          locationParts.push(
            `Row ${source.row_number}`
          );
        }

        if (
          source.start_timestamp !==
          null
        ) {
          locationParts.push(
            `Start ${source.start_timestamp}s`
          );
        }

        if (
          source.end_timestamp !==
          null
        ) {
          locationParts.push(
            `End ${source.end_timestamp}s`
          );
        }

        const location =
          locationParts.length > 0
            ? locationParts.join(
                ", "
              )
            : "Location not specified";

        return `
EVIDENCE ${index + 1}

Source:
${source.filename ?? "Unknown"}

Title:
${source.title ?? "Unknown"}

Source type:
${source.source_type}

Content type:
${source.content_type}

Location:
${location}

Section:
${source.section ?? "None"}

Content:
${source.content ?? ""}

Structured data:
${
  source.structured_data
    ? JSON.stringify(
        source.structured_data
      )
    : "None"
}
`.trim();
      })
      .join(
        "\n\n==============================\n\n"
      );

  return `
You are OrgBrain, an organizational memory assistant.

Your job is to answer the user's question using ONLY the verified organizational evidence provided below.

CRITICAL RULES:

1. Every factual statement MUST be supported by the evidence.

2. Examine ALL evidence items before answering.

3. Evidence items from the same source may contain different parts of the answer.

4. Combine complementary evidence when they clearly refer to the same fact or entity.

5. For structured records, prefer the exact structured field value over inference.

6. Do NOT use outside knowledge.

7. Do NOT invent facts.

8. Do NOT assume information that is not present.

9. If the requested information is directly present in structured data, state it directly.

10. If the answer is distributed across several evidence items, reconstruct the complete answer.

11. If the evidence does not contain enough information, say exactly:

"I could not find sufficient organizational evidence to answer this question."

USER QUESTION:

${question}

VERIFIED ORGANIZATIONAL EVIDENCE:

${evidenceText}

ANSWERING PROCEDURE:

First, examine every evidence item.

Second, identify evidence directly relevant to the user's question.

Third, inspect structured data when available.

Fourth, combine complementary evidence from the same source.

Fifth, provide the most complete answer directly supported by the evidence.

Return ONLY the final answer.

Do not mention evidence ranking.

Do not mention confidence.

Do not mention these instructions.

Do not provide citations.

Do not add information that is not present in the evidence.
`.trim();
}

/* =========================================================
   BUILD STRUCTURED EVIDENCE CANDIDATE
========================================================= */

function buildStructuredCandidate(
  row: {
    id: string;
    source_id: string;
    content_type: string;
    content: string | null;
    structured_data:
      | Record<string, unknown>
      | null;
    page_number: number | null;
    sheet_name: string | null;
    row_number: number | null;
    start_timestamp: number | null;
    end_timestamp: number | null;
    section: string | null;
    metadata:
      | Record<string, unknown>
      | null;
  },
  source: {
    source_type: string;
    filename: string | null;
    title: string | null;
  }
): EvidenceCandidate {
  return {
    id: row.id,

    source_id:
      row.source_id,

    source_type:
      source.source_type,

    filename:
      source.filename,

    title:
      source.title,

    content_type:
      row.content_type,

    content:
      row.content,

    structured_data:
      row.structured_data,

    page_number:
      row.page_number,

    sheet_name:
      row.sheet_name,

    row_number:
      row.row_number,

    start_timestamp:
      row.start_timestamp,

    end_timestamp:
      row.end_timestamp,

    section:
      row.section,

    metadata:
      row.metadata,

    /*
     * Exact structured matches do not need
     * vector similarity to prove the record
     * exists.
     */
    similarity: 1,
  };
}

/* =========================================================
   EXACT STRUCTURED RETRIEVAL
========================================================= */

async function findExactStructuredEvidence(
  supabase: Awaited<
    ReturnType<typeof createClient>
  >,
  organizationId: string,
  entity: string
): Promise<EvidenceCandidate[]> {
  /*
   * Retrieve structured row records belonging
   * to this organization.
   *
   * We intentionally do this in application
   * code rather than relying on vector search.
   *
   * This is critical for exact lookups.
   */

  const {
    data,
    error,
  } = await supabase
    .from("knowledge_content")
    .select(
      `
        id,
        source_id,
        content_type,
        content,
        structured_data,
        page_number,
        sheet_name,
        row_number,
        start_timestamp,
        end_timestamp,
        section,
        metadata
      `
    )
    .eq(
      "organization_id",
      organizationId
    )
    .eq(
      "content_type",
      "row"
    )
    .limit(5000);

  if (error) {
    console.error(
      "STRUCTURED RETRIEVAL ERROR:",
      error
    );

    return [];
  }

  if (!data || data.length === 0) {
    return [];
  }

  const normalizedEntity =
    normalize(entity);

  if (!normalizedEntity) {
    return [];
  }

  /*
   * Find exact/strong entity matches.
   */
  const matchedRows =
    data.filter((row) => {
      const structured =
        row.structured_data as
          | Record<
              string,
              unknown
            >
          | null;

      if (!structured) {
        return false;
      }

      /*
       * Account/customer records normally
       * contain account_name.
       */
      const accountName =
        typeof structured.account_name ===
        "string"
          ? normalize(
              structured.account_name
            )
          : "";

      if (
        accountName &&
        accountName ===
          normalizedEntity
      ) {
        return true;
      }

      /*
       * Also inspect customer_name.
       */
      const customerName =
        typeof structured.customer_name ===
        "string"
          ? normalize(
              structured.customer_name
            )
          : "";

      if (
        customerName &&
        customerName ===
          normalizedEntity
      ) {
        return true;
      }

      /*
       * Employee/person records.
       */
      const employeeName =
        typeof structured.employee_name ===
        "string"
          ? normalize(
              structured.employee_name
            )
          : "";

      if (
        employeeName &&
        employeeName ===
          normalizedEntity
      ) {
        return true;
      }

      /*
       * General fallback:
       * inspect string values in structured data.
       */
      return Object.values(
        structured
      ).some(
        (value) =>
          typeof value ===
            "string" &&
          normalize(value) ===
            normalizedEntity
      );
    });

  if (
    matchedRows.length === 0
  ) {
    return [];
  }

  /*
   * Get source metadata.
   */
  const sourceIds =
    Array.from(
      new Set(
        matchedRows.map(
          (row) =>
            row.source_id
        )
      )
    );

  const {
    data: sources,
    error: sourceError,
  } = await supabase
    .from("knowledge_sources")
    .select(
      `
        id,
        source_type,
        filename,
        title
      `
    )
    .in(
      "id",
      sourceIds
    )
    .eq(
      "organization_id",
      organizationId
    );

  if (sourceError) {
    console.error(
      "STRUCTURED SOURCE ERROR:",
      sourceError
    );

    return [];
  }

  const sourceMap =
    new Map(
      (sources ?? []).map(
        (source) => [
          source.id,
          source,
        ]
      )
    );

  /*
   * Convert exact structured rows into
   * normal EvidenceCandidate objects.
   */
  return matchedRows
    .map((row) => {
      const source =
        sourceMap.get(
          row.source_id
        );

      if (!source) {
        return null;
      }

      return buildStructuredCandidate(
        row,
        source
      );
    })
    .filter(
      (
        item
      ): item is EvidenceCandidate =>
        item !== null
    );
}

/* =========================================================
   FIND REQUESTED FIELD VALUE
========================================================= */

function getFieldValue(
  candidate: EvidenceCandidate,
  field: string
): unknown {
  const structured =
    candidate.structured_data;

  if (!structured) {
    return null;
  }

  return (
    structured[field] ??
    null
  );
}

/* =========================================================
   BUILD DIRECT STRUCTURED ANSWER
========================================================= */

function buildDirectStructuredAnswer(
  question: string,
  candidates: EvidenceCandidate[],
  requestedField: string
): {
  answer: string;
  evidence: EvidenceCandidate[];
} | null {
  if (
    candidates.length === 0
  ) {
    return null;
  }

  /*
   * Prefer records that actually contain
   * the requested field.
   */
  const matching =
    candidates.filter(
      (candidate) => {
        const value =
          getFieldValue(
            candidate,
            requestedField
          );

        return (
          value !== null &&
          value !== undefined &&
          String(value).trim() !== ""
        );
      }
    );

  if (
    matching.length === 0
  ) {
    return null;
  }

  const primary =
    matching[0];

  const value =
    getFieldValue(
      primary,
      requestedField
    );

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  /*
   * Friendly field labels.
   */
  const labels: Record<
    string,
    string
  > = {
    account_number:
      "account number",

    avail_balance:
      "available balance",

    un_cleared_balance:
      "uncleared balance",

    contact:
      "contact",

    open_date:
      "open date",

    employee_id:
      "employee ID",

    customer_id:
      "customer ID",
  };

  const fieldLabel =
    labels[
      requestedField
    ] ??
    requestedField.replace(
      /_/g,
      " "
    );

  const structured =
    primary.structured_data ??
    {};

  const name =
    structured.account_name ??
    structured.customer_name ??
    structured.employee_name ??
    "The requested record";

  return {
    answer:
      `${name}'s ${fieldLabel} is ${value}.`,

    evidence: matching,
  };
}

/* =========================================================
   SOURCE-AWARE EVIDENCE EXPANSION
========================================================= */

async function expandSourceEvidence(
  supabase: Awaited<
    ReturnType<typeof createClient>
  >,
  sourceId: string,
  organizationId: string,
  primaryEvidence: EvidenceCandidate[]
): Promise<EvidenceCandidate[]> {
  const {
    data,
    error,
  } = await supabase
    .from("knowledge_content")
    .select(
      `
        id,
        source_id,
        content_type,
        content,
        structured_data,
        page_number,
        sheet_name,
        row_number,
        start_timestamp,
        end_timestamp,
        section,
        metadata,
        content_index
      `
    )
    .eq(
      "source_id",
      sourceId
    )
    .eq(
      "organization_id",
      organizationId
    )
    .eq(
      "embedding_status",
      "embedded"
    )
    .order(
      "content_index",
      {
        ascending: true,
      }
    );

  if (error) {
    console.error(
      "SOURCE EXPANSION ERROR:",
      error
    );

    return primaryEvidence;
  }

  if (
    !data ||
    data.length === 0
  ) {
    return primaryEvidence;
  }

  const existingIds =
    new Set(
      primaryEvidence.map(
        (item) => item.id
      )
    );

  const primary =
    primaryEvidence[0];

  const expanded =
    data
      .filter(
        (item) =>
          !existingIds.has(
            item.id
          )
      )
      .filter((item) => {
        const hasContent =
          Boolean(
            item.content?.trim()
          );

        const hasStructuredData =
          Object.keys(
            item.structured_data ??
              {}
          ).length > 0;

        return (
          hasContent ||
          hasStructuredData
        );
      })
      .map(
        (item) =>
          ({
            id: item.id,

            source_id:
              item.source_id,

            source_type:
              primary?.source_type ??
              "unknown",

            filename:
              primary?.filename ??
              null,

            title:
              primary?.title ??
              null,

            content_type:
              item.content_type,

            content:
              item.content,

            structured_data:
              item.structured_data,

            page_number:
              item.page_number,

            sheet_name:
              item.sheet_name,

            row_number:
              item.row_number,

            start_timestamp:
              item.start_timestamp,

            end_timestamp:
              item.end_timestamp,

            section:
              item.section,

            metadata:
              item.metadata,

            /*
             * Source-expanded records do not
             * have semantic similarity.
             */
            similarity: 0,
          }) satisfies EvidenceCandidate
      );

  return [
    ...primaryEvidence,
    ...expanded,
  ];
}

/* =========================================================
   POST
========================================================= */

export async function POST(
  request: Request
) {
  const supabase =
    await createClient();

  try {
    /* =====================================================
       1. AUTHENTICATE
    ===================================================== */

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

    /* =====================================================
       2. GET ORGANIZATION
    ===================================================== */

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
            "User organization not found.",
        },
        {
          status: 403,
        }
      );
    }

    const organizationId =
      profile.organization_id;

    /* =====================================================
       3. PARSE REQUEST
    ===================================================== */

    let body: AnswerRequest;

    try {
      body =
        await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid JSON request.",
        },
        {
          status: 400,
        }
      );
    }

    const question =
      typeof body.question ===
      "string"
        ? body.question.trim()
        : "";

    if (!question) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Question is required.",
        },
        {
          status: 400,
        }
      );
    }

    /* =====================================================
       4. LIMIT
    ===================================================== */

    const requestedLimit =
      Number.isInteger(
        body.limit
      )
        ? Number(body.limit)
        : 10;

    const limit =
      Math.min(
        Math.max(
          requestedLimit,
          1
        ),
        20
      );

    /* =====================================================
       5. DETERMINE QUESTION TYPE
    ===================================================== */

    const exactLookup =
      isExactLookupQuestion(
        question
      );

    const entity =
      extractEntity(
        question
      );

    const requestedField =
      getRequestedField(
        question
      );

    /* =====================================================
       6. EXACT STRUCTURED RETRIEVAL
       
       THIS IS THE CRITICAL NEW STEP.
       
       For:
       
       "What is the account number of Josephine Osae?"
       
       we search the structured organizational
       records BEFORE vector retrieval.
    ===================================================== */

    if (
      exactLookup &&
      entity
    ) {
      console.log(
        "EXACT LOOKUP:",
        {
          question,
          entity,
          requestedField,
        }
      );

      const structuredEvidence =
        await findExactStructuredEvidence(
          supabase,
          organizationId,
          entity
        );

      /*
       * If the requested entity was found,
       * verify the requested field directly.
       */
      if (
        structuredEvidence.length >
        0
      ) {
        /*
         * If a specific field was requested,
         * try to answer directly from that field.
         */
        if (
          requestedField
        ) {
          const directAnswer =
            buildDirectStructuredAnswer(
              question,
              structuredEvidence,
              requestedField
            );

          if (
            directAnswer
          ) {
            const evidence =
              directAnswer.evidence.map(
                (item) => ({
                  source:
                    item,

                  citation: {
                    filename:
                      item.filename,

                    page:
                      item.page_number,

                    sheet:
                      item.sheet_name,

                    row:
                      item.row_number,

                    startTimestamp:
                      item.start_timestamp,

                    endTimestamp:
                      item.end_timestamp,
                  },
                })
              );

            return NextResponse.json({
              success: true,

              question,

              organizationId,

              answer:
                directAnswer.answer,

              status:
                "supported",

              /*
               * Exact structured records are
               * direct evidence.
               */
              confidence: 1,

              evidenceStrength:
                "strong",

              evidence,

              reason:
                "The requested entity and field were found directly in structured organizational records.",

              model:
                "structured-record-lookup",
            });
          }
        }

        /*
         * If we found the entity but could not
         * resolve the requested field, continue
         * into the normal verification pipeline
         * with the exact structured evidence.
         */
        const verification =
          verifyEvidence(
            question,
            structuredEvidence
          );

        if (
          verification.evidence
        ) {
          const verifiedEvidence =
            buildEvidenceContext(
              verification.evidence,
              verification.supportingEvidence
            );

          const answerResponse =
            await openai.responses.create(
              {
                model:
                  ANSWER_MODEL,

                input:
                  buildAnswerPrompt(
                    question,
                    verifiedEvidence
                  ),
              }
            );

          const answer =
            answerResponse
              .output_text
              ?.trim() ??
            "";

          if (answer) {
            return NextResponse.json({
              success: true,

              question,

              organizationId,

              answer,

              status:
                verification.status,

              confidence:
                verification.confidence,

              evidenceStrength:
                verification.evidenceStrength,

              evidence:
                verifiedEvidence,

              reason:
                verification.reason,

              model:
                ANSWER_MODEL,
            });
          }
        }

        /*
         * Entity exists but requested information
         * could not be resolved.
         */
        return NextResponse.json({
          success: true,

          question,

          organizationId,

          answer:
            "I could not find sufficient organizational evidence to answer this question.",

          status:
            "unknown",

          confidence: 0,

          evidenceStrength:
            "none",

          evidence: [],

          reason:
            `The entity "${entity}" was found in organizational records, but the requested information could not be verified.`,
        });
      }

      /*
       * IMPORTANT:
       *
       * Do not immediately return Unknown.
       *
       * The structured data might not contain
       * this particular record, while another
       * document could contain it.
       *
       * Therefore continue to semantic retrieval.
       */
    }

    /* =====================================================
       7. CREATE QUESTION EMBEDDING
       
       This is now the FALLBACK path for exact
       lookups and the PRIMARY path for general
       knowledge questions.
    ===================================================== */

    const embeddingResponse =
      await openai.embeddings.create(
        {
          model:
            EMBEDDING_MODEL,

          input:
            question,
        }
      );

    const queryEmbedding =
      embeddingResponse
        .data[0]
        ?.embedding;

    if (!queryEmbedding) {
      throw new Error(
        "Failed to create question embedding."
      );
    }

    /* =====================================================
       8. SEMANTIC RETRIEVAL
    ===================================================== */

    const {
      data: results,
      error:
        retrievalError,
    } =
      await supabase.rpc(
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

    const candidates =
      (results ??
        []) as EvidenceCandidate[];

    /* =====================================================
       9. NO SEMANTIC RESULTS
    ===================================================== */

    if (
      candidates.length === 0
    ) {
      return NextResponse.json({
        success: true,

        question,

        organizationId,

        answer:
          "I could not find sufficient organizational evidence to answer this question.",

        status:
          "unknown",

        confidence: 0,

        evidenceStrength:
          "none",

        evidence: [],

        reason:
          "No organizational evidence was retrieved.",
      });
    }

    /* =====================================================
       10. SOURCE-AWARE EXPANSION
    ===================================================== */

    let expandedCandidates =
      candidates;

    if (
      candidates[0]?.source_id
    ) {
      expandedCandidates =
        await expandSourceEvidence(
          supabase,
          candidates[0].source_id,
          organizationId,
          candidates
        );
    }

    /* =====================================================
       11. VERIFY EVIDENCE
    ===================================================== */

    const verification =
      verifyEvidence(
        question,
        expandedCandidates
      );

    /* =====================================================
       12. NO RELIABLE EVIDENCE
    ===================================================== */

    if (
      verification.status ===
        "unknown" ||
      !verification.evidence
    ) {
      return NextResponse.json({
        success: true,

        question,

        organizationId,

        answer:
          "I could not find sufficient organizational evidence to answer this question.",

        status:
          "unknown",

        confidence: 0,

        evidenceStrength:
          verification.evidenceStrength,

        evidence: [],

        reason:
          verification.reason,
      });
    }

    /* =====================================================
       13. BUILD VERIFIED EVIDENCE
    ===================================================== */

    const verifiedEvidence =
      buildEvidenceContext(
        verification.evidence,
        verification.supportingEvidence
      );

    /* =====================================================
       14. GENERATE ANSWER
    ===================================================== */

    const answerResponse =
      await openai.responses.create(
        {
          model:
            ANSWER_MODEL,

          input:
            buildAnswerPrompt(
              question,
              verifiedEvidence
            ),
        }
      );

    const answer =
      answerResponse
        .output_text
        ?.trim() ??
      "";

    if (!answer) {
      throw new Error(
        "The answer model returned an empty response."
      );
    }

    /* =====================================================
       15. RETURN ANSWER
    ===================================================== */

    return NextResponse.json({
      success: true,

      question,

      organizationId,

      answer,

      status:
        verification.status,

      confidence:
        verification.confidence,

      evidenceStrength:
        verification.evidenceStrength,

      evidence:
        verifiedEvidence,

      reason:
        verification.reason,

      model:
        ANSWER_MODEL,
    });
  } catch (
    error: unknown
  ) {
    console.error(
      "UNIVERSAL ANSWER ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Universal answer generation failed.",
      },
      {
        status: 500,
      }
    );
  }
}