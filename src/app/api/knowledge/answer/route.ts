import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type Understanding = {
  entity: string | null;
  intent: string;
  requested_field: string | null;
  search_terms: string[];
  question_type: string;
};

type StructuredRecord = {
  id: string;
  organization_id: string;
  document_id: string;
  record_type: string;
  record_data: Record<string, unknown>;
  row_number: number | null;
};

type StructuredResult = StructuredRecord & {
  match_score: number;
  source?: {
    document_id: string;
    filename: string | null;
    document_type: string | null;
    department: string | null;
    row_number: number | null;
  };
};

type VerificationResult = {
  verified: boolean;
  status: "Supported" | "Inferred" | "Unknown";
  confidence: number;
  reason: string;
  entity_match: boolean;
  field_found: boolean;
  evidence_sufficient: boolean;
  verified_value: string | null;
};

const FIELD_MAP: Record<string, string> = {
  account_number: "account_number",
  account_name: "account_name",
  open_date: "open_date",
  available_balance: "avail_balance",
  uncleared_balance: "un_cleared_balance",
  customer_name: "customer_name",
  employee_name: "employee_name",
  department: "department",
  contact: "contact",
  amount: "amount",
  date: "date",
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function cleanEntity(value: string | null): string {
  if (!value) return "";

  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ");
}

function recordMatchesEntity(
  record: StructuredRecord,
  entity: string
): boolean {
  const target = normalize(entity);

  if (!target) return false;

  const data = record.record_data || {};

  const possibleNames = [
    data.account_name,
    data.customer_name,
    data.employee_name,
    data.name,
  ];

  return possibleNames.some((value) => {
    const current = normalize(value);

    if (!current) return false;

    return (
      current === target ||
      current.includes(target)
    );
  });
}

function calculateMatchScore(
  record: StructuredRecord,
  entity: string
): number {
  const data = record.record_data || {};
  const target = normalize(entity);

  let score = 0;

  const accountName = normalize(
    data.account_name
  );

  const customerName = normalize(
    data.customer_name
  );

  const employeeName = normalize(
    data.employee_name
  );

  const accountNumber = normalize(
    data.account_number
  );

  if (accountName === target) {
    score = Math.max(score, 120);
  } else if (accountName.includes(target)) {
    score = Math.max(score, 100);
  }

  if (customerName === target) {
    score = Math.max(score, 120);
  } else if (customerName.includes(target)) {
    score = Math.max(score, 100);
  }

  if (employeeName === target) {
    score = Math.max(score, 120);
  } else if (employeeName.includes(target)) {
    score = Math.max(score, 100);
  }

  if (accountNumber === target) {
    score = Math.max(score, 130);
  } else if (accountNumber.includes(target)) {
    score = Math.max(score, 110);
  }

  return score;
}

function getRequestedValue(
  record: StructuredRecord,
  requestedField: string | null
): string | null {
  if (!requestedField) {
    return null;
  }

  const actualField =
    FIELD_MAP[requestedField];

  if (!actualField) {
    return null;
  }

  const value =
    record.record_data?.[actualField];

  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const stringValue =
    String(value).trim();

  if (!stringValue) {
    return null;
  }

  return stringValue;
}

function verifyStructuredEvidence(
  result: StructuredResult,
  understanding: Understanding
): VerificationResult {
  const entity = cleanEntity(
    understanding.entity
  );

  const entityMatch =
    !!entity &&
    recordMatchesEntity(
      result,
      entity
    );

  const verifiedValue =
    getRequestedValue(
      result,
      understanding.requested_field
    );

  const fieldFound =
    verifiedValue !== null;

  const exactEntityMatch =
    entityMatch &&
    calculateMatchScore(
      result,
      entity
    ) >= 120;

  const evidenceSufficient =
    exactEntityMatch &&
    fieldFound;

  if (evidenceSufficient) {
    return {
      verified: true,
      status: "Supported",
      confidence: 1,

      reason:
        "The requested field was found directly in the organization's structured record for the identified entity.",

      entity_match: true,
      field_found: true,
      evidence_sufficient: true,

      verified_value:
        verifiedValue,
    };
  }

  return {
    verified: false,
    status: "Unknown",
    confidence: 0,

    reason: !entityMatch
      ? "The retrieved record does not reliably match the requested entity."
      : !fieldFound
      ? "The requested field was not found in the entity's structured record."
      : "The available evidence was not sufficiently reliable to verify the answer.",

    entity_match: entityMatch,
    field_found: fieldFound,
    evidence_sufficient: false,
    verified_value: null,
  };
}

function buildExactAnswer(
  entity: string,
  requestedField: string,
  value: string
): string {
  switch (requestedField) {
    case "account_number":
      return `${entity}'s account number is ${value}.`;

    case "account_name":
      return `The account name is ${value}.`;

    case "open_date":
      return `${entity}'s account was opened on ${value}.`;

    case "available_balance":
      return `${entity}'s available balance is ${value}.`;

    case "uncleared_balance":
      return `${entity}'s uncleared balance is ${value}.`;

    default:
      return `${entity}: ${value}.`;
  }
}

async function understandQuestion(
  question: string
): Promise<Understanding> {
  const response =
    await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,

      response_format: {
        type: "json_object",
      },

      messages: [
        {
          role: "system",

          content: `
You are the Question Understanding layer of an organizational knowledge system.

Extract the important searchable meaning from the user's question.

Return ONLY valid JSON with this structure:

{
  "entity": null,
  "intent": "unknown",
  "requested_field": null,
  "search_terms": [],
  "question_type": "unknown"
}

Allowed intents:
- account_lookup
- customer_lookup
- employee_lookup
- document_lookup
- policy_lookup
- procedure_lookup
- financial_lookup
- transaction_lookup
- general_knowledge
- unknown

Allowed requested_field values:
- account_number
- account_name
- open_date
- available_balance
- uncleared_balance
- customer_name
- employee_name
- department
- contact
- amount
- date
- policy
- procedure
- unknown

Allowed question_type values:
- exact_lookup
- list
- comparison
- explanation
- summary
- general_question
- unknown

Rules:

1. "account number" means account_number.
2. "available balance" means available_balance.
3. "avail balance" means available_balance.
4. "available amount" means available_balance.
5. "uncleared balance" means uncleared_balance.
6. "un-cleared balance" means uncleared_balance.
7. "open date" means open_date.
8. "date opened" means open_date.
9. Extract the person's/customer/account entity whenever present.
10. Preserve the entity's actual name.
11. For a specific record lookup, use question_type = exact_lookup.
12. Do not invent entities or fields.
13. Account number, balance, uncleared balance and account-specific fields should normally use intent = account_lookup.
14. Only use customer_lookup when the question is genuinely about customer information rather than an account record.
          `,
        },

        {
          role: "user",
          content: question,
        },
      ],
    });

  const content =
    response.choices[0]?.message
      ?.content;

  if (!content) {
    throw new Error(
      "Question understanding returned no result."
    );
  }

  const parsed =
    JSON.parse(content);

  return {
    entity:
      typeof parsed.entity === "string"
        ? cleanEntity(parsed.entity)
        : null,

    intent:
      typeof parsed.intent === "string"
        ? parsed.intent
        : "unknown",

    requested_field:
      typeof parsed.requested_field ===
      "string"
        ? parsed.requested_field
        : null,

    search_terms:
      Array.isArray(
        parsed.search_terms
      )
        ? parsed.search_terms.filter(
            (
              item: unknown
            ): item is string =>
              typeof item ===
              "string"
          )
        : [],

    question_type:
      typeof parsed.question_type ===
      "string"
        ? parsed.question_type
        : "unknown",
  };
}

async function retrieveStructuredRecords(
  supabase: Awaited<
    ReturnType<typeof createClient>
  >,
  organizationId: string,
  understanding: Understanding
): Promise<StructuredResult[]> {
  const entity =
    cleanEntity(
      understanding.entity
    ) ||
    understanding.search_terms?.[0] ||
    "";

  if (!entity) {
    return [];
  }

  /*
   * Retrieve structured records belonging
   * ONLY to the authenticated organization.
   */

  const {
    data,
    error,
  } = await supabase
    .from("structured_records")
    .select(
      `
        id,
        organization_id,
        document_id,
        record_type,
        record_data,
        row_number
      `
    )
    .eq(
      "organization_id",
      organizationId
    )
    .limit(1000);

  if (error) {
    console.error(
      "STRUCTURED RECORD RETRIEVAL ERROR:",
      error
    );

    throw error;
  }

  const records =
    (data || []) as StructuredRecord[];

  const results: StructuredResult[] =
    records
      .map((record) => ({
        ...record,

        match_score:
          calculateMatchScore(
            record,
            entity
          ),
      }))
      .filter(
        (record) =>
          record.match_score > 0
      )
      .sort(
        (a, b) =>
          b.match_score -
          a.match_score
      )
      .slice(0, 10);

  if (!results.length) {
    return [];
  }

  /*
   * Fetch source document metadata.
   */

  const documentIds = [
    ...new Set(
      results.map(
        (result) =>
          result.document_id
      )
    ),
  ];

  const {
    data: documents,
    error: documentsError,
  } = await supabase
    .from("documents")
    .select(
      "id, filename, document_type, department"
    )
    .in(
      "id",
      documentIds
    )
    .eq(
      "organization_id",
      organizationId
    );

  if (documentsError) {
    console.error(
      "SOURCE DOCUMENT ERROR:",
      documentsError
    );

    throw documentsError;
  }

  const documentMap =
    new Map(
      (documents || []).map(
        (document) => [
          document.id,
          document,
        ]
      )
    );

  return results.map(
    (result) => {
      const document =
        documentMap.get(
          result.document_id
        );

      return {
        ...result,

        source: {
          document_id:
            result.document_id,

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
            result.row_number,
        },
      };
    }
  );
}

async function retrieveSemanticEvidence(
  supabase: Awaited<
    ReturnType<typeof createClient>
  >,
  organizationId: string,
  question: string
) {
  const embeddingResponse =
    await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: question,
    });

  const queryEmbedding =
    embeddingResponse.data[0]
      .embedding;

  const {
    data,
    error,
  } = await supabase.rpc(
    "match_document_chunks",
    {
      query_embedding:
        queryEmbedding,

      match_count: 5,

      match_organization_id:
        organizationId,
    }
  );

  if (error) {
    console.error(
      "SEMANTIC RETRIEVAL ERROR:",
      error
    );

    throw error;
  }

  return data || [];
}

export async function POST(
  request: Request
) {
  const supabase =
    await createClient();

  try {
    /*
     * ---------------------------------------------------------
     * 1. AUTHENTICATION
     * ---------------------------------------------------------
     */

    const {
      data: { user },
      error: authError,
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

    /*
     * ---------------------------------------------------------
     * 2. ORGANIZATION
     * ---------------------------------------------------------
     */

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

    /*
     * ---------------------------------------------------------
     * 3. QUESTION
     * ---------------------------------------------------------
     */

    const body =
      await request.json();

    const question =
      typeof body.question ===
      "string"
        ? body.question.trim()
        : "";

    if (!question) {
      return NextResponse.json(
        {
          error:
            "Question is required.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * ---------------------------------------------------------
     * 4. QUESTION UNDERSTANDING
     * ---------------------------------------------------------
     */

    const understanding =
      await understandQuestion(
        question
      );

    console.log(
      "QUESTION UNDERSTANDING:",
      understanding
    );

    /*
     * Normalize nullable values ONCE.
     * This also prevents TypeScript errors.
     */

    const entity =
      cleanEntity(
        understanding.entity
      );

    const requestedField =
      understanding.requested_field ||
      "";

    /*
     * ---------------------------------------------------------
     * 5. STRUCTURED RETRIEVAL
     * ---------------------------------------------------------
     */

    const structuredResults =
      await retrieveStructuredRecords(
        supabase,
        organizationId,
        understanding
      );

    console.log(
      "STRUCTURED RESULTS:",
      structuredResults.map(
        (item) => ({
          entity:
            item.record_data
              ?.account_name,

          account:
            item.record_data
              ?.account_number,

          available:
            item.record_data
              ?.avail_balance,

          uncleared:
            item.record_data
              ?.un_cleared_balance,

          score:
            item.match_score,
        })
      )
    );

    /*
     * ---------------------------------------------------------
     * 6. EXACT LOOKUP
     * ---------------------------------------------------------
     */

    const isExactLookup =
      understanding.question_type ===
        "exact_lookup" &&
      !!entity &&
      !!requestedField;

    if (isExactLookup) {
      /*
       * IMPORTANT:
       *
       * Exact lookups NEVER fall through to
       * semantic retrieval if the entity cannot
       * be found in structured records.
       */

      if (
        structuredResults.length === 0
      ) {
        return NextResponse.json({
          success: true,

          question,

          organizationId,

          understanding,

          answer:
            `I could not verify ${entity}'s ${requestedField.replace(
              /_/g,
              " "
            )} from the organization's knowledge.`,

          status: "Unknown",

          confidence: 0,

          source_summary:
            "No matching structured organizational record was found.",

          verification: {
            verified: false,

            status: "Unknown",

            confidence: 0,

            reason:
              "No structured organizational record matching the requested entity was found. Semantic evidence was not used to infer an exact record value.",

            entity_match: false,

            field_found: false,

            evidence_sufficient:
              false,

            verified_value:
              null,
          },

          evidence: [],
        });
      }

      /*
       * -------------------------------------------------------
       * BEST STRUCTURED RECORD
       * -------------------------------------------------------
       */

      const bestRecord =
        structuredResults[0];

      /*
       * -------------------------------------------------------
       * VERIFY
       * -------------------------------------------------------
       */

      const verification =
        verifyStructuredEvidence(
          bestRecord,
          understanding
        );

      console.log(
        "STRUCTURED VERIFICATION:",
        verification
      );

      /*
       * -------------------------------------------------------
       * VERIFIED EXACT ANSWER
       * -------------------------------------------------------
       */

      if (
        verification.verified &&
        verification.verified_value !==
          null
      ) {
        const answer =
          buildExactAnswer(
            entity,
            requestedField,
            verification.verified_value
          );

        return NextResponse.json({
          success: true,

          question,

          organizationId,

          understanding,

          answer,

          status: "Supported",

          confidence: 1,

          source_summary:
            `Verified directly from ${
              bestRecord.source
                ?.filename ||
              "the organization's structured records"
            }.`,

          verification,

          evidence: [
            {
              id:
                bestRecord.id,

              document_id:
                bestRecord.document_id,

              filename:
                bestRecord.source
                  ?.filename ||
                null,

              document_type:
                bestRecord.source
                  ?.document_type ||
                null,

              department:
                bestRecord.source
                  ?.department ||
                null,

              row_number:
                bestRecord.row_number,

              match_score:
                bestRecord.match_score,

              content:
                JSON.stringify(
                  bestRecord.record_data,
                  null,
                  2
                ),
            },
          ],
        });
      }

      /*
       * -------------------------------------------------------
       * RECORD FOUND BUT FIELD NOT VERIFIED
       * -------------------------------------------------------
       *
       * DO NOT use semantic retrieval.
       * DO NOT ask the LLM to guess.
       */

      return NextResponse.json({
        success: true,

        question,

        organizationId,

        understanding,

        answer:
          "I could not verify a reliable answer from the organization's knowledge.",

        status: "Unknown",

        confidence: 0,

        source_summary:
          "A matching organizational record was found, but the requested field could not be verified.",

        verification,

        evidence:
          structuredResults
            .slice(0, 5)
            .map(
              (item) => ({
                id:
                  item.id,

                document_id:
                  item.document_id,

                filename:
                  item.source
                    ?.filename ||
                  null,

                document_type:
                  item.source
                    ?.document_type ||
                  null,

                department:
                  item.source
                    ?.department ||
                  null,

                row_number:
                  item.row_number,

                match_score:
                  item.match_score,

                content:
                  JSON.stringify(
                    item.record_data,
                    null,
                    2
                  ),
              })
            ),
      });
    }

    /*
     * ---------------------------------------------------------
     * 7. SEMANTIC RETRIEVAL
     * ---------------------------------------------------------
     *
     * Only non-exact questions reach this point.
     */

    const semanticResults =
      await retrieveSemanticEvidence(
        supabase,
        organizationId,
        question
      );

    /*
     * ---------------------------------------------------------
     * 8. BUILD BROADER EVIDENCE
     * ---------------------------------------------------------
     */

    const evidence = [
      ...structuredResults
        .slice(0, 5)
        .map(
          (item) => ({
            type:
              "structured",

            id:
              item.id,

            document_id:
              item.document_id,

            filename:
              item.source
                ?.filename ||
              null,

            document_type:
              item.source
                ?.document_type ||
              null,

            department:
              item.source
                ?.department ||
              null,

            row_number:
              item.row_number,

            match_score:
              item.match_score,

            content:
              JSON.stringify(
                item.record_data,
                null,
                2
              ),
          })
        ),

      ...semanticResults.map(
        (item: any) => ({
          type:
            "semantic",

          id:
            item.id,

          document_id:
            item.document_id,

          filename:
            item.filename ||
            null,

          document_type:
            item.document_type ||
            null,

          department:
            item.department ||
            null,

          page_number:
            item.page_number ||
            null,

          chunk_index:
            item.chunk_index,

          similarity:
            item.similarity,

          content:
            item.content,
        })
      ),
    ];

    /*
     * ---------------------------------------------------------
     * 9. NO EVIDENCE
     * ---------------------------------------------------------
     */

    if (!evidence.length) {
      return NextResponse.json({
        success: true,

        question,

        organizationId,

        understanding,

        answer:
          "I could not verify a reliable answer from the organization's knowledge.",

        status: "Unknown",

        confidence: 0,

        source_summary:
          "No relevant organizational evidence was found.",

        verification: {
          verified: false,

          status: "Unknown",

          confidence: 0,

          reason:
            "No relevant evidence was retrieved.",

          entity_match:
            false,

          field_found:
            false,

          evidence_sufficient:
            false,

          verified_value:
            null,
        },

        evidence: [],
      });
    }

    /*
     * ---------------------------------------------------------
     * 10. AI ANSWER FOR BROADER QUESTIONS
     * ---------------------------------------------------------
     */

    const evidenceText =
      evidence
        .map(
          (item, index) => `
SOURCE ${index + 1}

Filename:
${item.filename || "Unknown"}

Document type:
${item.document_type || "Unknown"}

Department:
${item.department || "Unknown"}

Page:
${item.page_number ?? "N/A"}

Row:
${item.row_number ?? "N/A"}

Content:
${item.content}
`
        )
        .join("\n");

    const answerResponse =
      await openai.chat.completions.create(
        {
          model: "gpt-4o-mini",
          temperature: 0,

          messages: [
            {
              role: "system",

              content: `
You are OrgBrain, an organizational knowledge assistant.

Answer ONLY from the supplied organizational evidence.

Rules:

1. Never invent facts.
2. Never use outside knowledge when answering an organization-specific question.
3. If the evidence does not support an answer, say that you cannot verify it.
4. Be concise and direct.
5. Distinguish between supported facts and inference.
6. Do not claim something is verified unless the evidence directly supports it.
              `,
            },

            {
              role: "user",

              content: `
QUESTION:
${question}

QUESTION UNDERSTANDING:
${JSON.stringify(
                understanding,
                null,
                2
              )}

ORGANIZATIONAL EVIDENCE:
${evidenceText}

Provide the best answer supported by the evidence.
              `,
            },
          ],
        }
      );

    const aiAnswer =
      answerResponse
        .choices[0]
        ?.message
        ?.content
        ?.trim();

    /*
     * If the model cannot produce an answer,
     * classify it as Unknown.
     */

    if (!aiAnswer) {
      return NextResponse.json({
        success: true,

        question,

        organizationId,

        understanding,

        answer:
          "I could not verify a reliable answer from the organization's knowledge.",

        status: "Unknown",

        confidence: 0,

        source_summary:
          "The available organizational evidence was insufficient to produce a reliable answer.",

        verification: {
          verified: false,

          status: "Unknown",

          confidence: 0,

          reason:
            "The evidence was insufficient for a reliable answer.",

          entity_match:
            !!entity,

          field_found:
            !!requestedField,

          evidence_sufficient:
            false,

          verified_value:
            null,
        },

        evidence,
      });
    }

    /*
     * ---------------------------------------------------------
     * 11. BROADER AI ANSWER
     * ---------------------------------------------------------
     */

    return NextResponse.json({
      success: true,

      question,

      organizationId,

      understanding,

      answer:
        aiAnswer,

      status: "Supported",

      confidence: 0.8,

      source_summary:
        `${evidence.length} organizational evidence item(s) were retrieved.`,

      verification: {
        verified: false,

        status: "Supported",

        confidence: 0.8,

        reason:
          "This was a broader question requiring evidence-based synthesis rather than a deterministic structured lookup.",

        entity_match:
          !!entity,

        field_found:
          !!requestedField,

        evidence_sufficient:
          evidence.length > 0,

        verified_value:
          null,
      },

      evidence,
    });
  } catch (error: unknown) {
    console.error(
      "ANSWER ENGINE ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Answer generation failed.",
      },
      {
        status: 500,
      }
    );
  }
}