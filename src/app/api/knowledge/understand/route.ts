// src/app/api/knowledge/understand/route.ts

import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  classifyQuestion,
  type LanguageUnderstanding,
} from "@/lib/knowledge/language";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  const supabase = await createClient();

  try {
    // ==========================================
    // 1. AUTHENTICATE USER
    // ==========================================

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          error: "Authentication required.",
        },
        {
          status: 401,
        }
      );
    }

    // ==========================================
    // 2. CONFIRM ORGANIZATION
    // ==========================================

    const { data: profile, error: profileError } =
      await supabase
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
          error:
            "Organization profile not found.",
        },
        {
          status: 403,
        }
      );
    }

    // ==========================================
    // 3. READ QUESTION
    // ==========================================

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
        {
          status: 400,
        }
      );
    }

    // ==========================================
    // 4. DETERMINISTIC LANGUAGE ENGINE
    // ==========================================

    const deterministic =
      classifyQuestion(question);

      console.log("ORG BRAIN DETERMINISTIC:", {
  question,
  entity: deterministic.entity,
  intent: deterministic.intent,
  field: deterministic.requested_field,
  type: deterministic.question_type,
  confidence: deterministic.confidence,
  method: deterministic.method,
});
    /*
     * If our own language engine has enough
     * information, trust it.
     *
     * Example:
     *
     * Find Seth Olai account number
     *
     * becomes:
     *
     * entity = seth olai
     * intent = account_lookup
     * requested_field = account_number
     * question_type = exact_lookup
     */

    console.log("========== PROCEDURE DETERMINISTIC DEBUG ==========");
console.log({
  question,
  deterministic,
  entity: deterministic.entity,
  intent: deterministic.intent,
  field: deterministic.requested_field,
  type: deterministic.question_type,
  confidence: deterministic.confidence,
});

   const deterministicIsStrong =
  deterministic.intent !== "unknown" &&
  (
    (
      deterministic.entity !== null &&
      (
        deterministic.requested_field !== "unknown" ||
        deterministic.intent === "transaction_lookup" ||
        deterministic.intent === "document_lookup" ||
        deterministic.intent === "policy_lookup" ||
        deterministic.intent === "procedure_lookup" ||
        deterministic.intent === "decision_lookup" ||
        deterministic.intent === "project_lookup" ||
        deterministic.intent === "financial_lookup"
      )
    ) ||
    deterministic.intent === "general_knowledge"
  );

        console.log(
  "DETERMINISTIC IS STRONG:",
  deterministicIsStrong
);
console.log("==========================================");

    if (deterministicIsStrong) {
      return NextResponse.json({
        success: true,
        question,
        organizationId:
          profile.organization_id,
        understanding: deterministic,
      });
    }

    // ==========================================
    // 5. LLM FALLBACK
    // ==========================================

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
You are the advanced Question Understanding engine for OrgBrain, an Organizational AI Memory system.

Your job is NOT to answer the user's question.

Your job is to convert the user's natural-language question into a structured representation for downstream retrieval.

Return ONLY valid JSON.

Use exactly this structure:

{
  "entity": null,
  "intent": "unknown",
  "requested_field": "unknown",
  "search_terms": [],
  "question_type": "unknown"
}

Possible intents:

- account_lookup
- customer_lookup
- employee_lookup
- document_lookup
- policy_lookup
- procedure_lookup
- financial_lookup
- transaction_lookup
- decision_lookup
- project_lookup
- general_knowledge
- unknown

Possible requested_field values:

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

Possible question_type values:

- exact_lookup
- list
- comparison
- explanation
- summary
- general_question
- unknown

IMPORTANT LANGUAGE RULES:

Different verbs can represent the same lookup operation.

For example:

find
get
show
give
retrieve
lookup
look up
provide
tell
fetch
check
search
locate
identify
display
return
bring
pull
obtain
access
view

These should NOT change the underlying intent.

For example:

"Find Seth Olai account number"
"What is Seth Olai account number?"
"Get Seth Olai account number"
"Show Seth Olai account number"
"Retrieve Seth Olai account number"
"Look up Seth Olai account number"

must all become:

intent = "account_lookup"
requested_field = "account_number"
question_type = "exact_lookup"
entity = "Seth Olai"

ACCOUNT NUMBER:

If the user asks for:

account number
account no
account #
acct number
acct no
account identifier

use:

intent = "account_lookup"
requested_field = "account_number"

BALANCE:

If the user asks:

balance
available balance
current balance
how much money
how much is available
available funds
funds available

use:

intent = "account_lookup"
requested_field = "available_balance"

UNCLEARED BALANCE:

Use:

requested_field = "uncleared_balance"

OPEN DATE:

Use:

requested_field = "open_date"

CONTACT:

phone
phone number
telephone
telephone number
contact
contact number
mobile
mobile number

should map to:

requested_field = "contact"

Always preserve the actual entity mentioned by the user.

Do not invent entities.

Normalize capitalization.

search_terms should contain useful terms for downstream retrieval.

Do not answer the user's question.
            `,
          },
          {
            role: "user",
            content: question,
          },
        ],
      });

    // ==========================================
    // 6. PARSE LLM RESPONSE
    // ==========================================

    const content =
      response.choices[0]?.message?.content;

    if (!content) {
      throw new Error(
        "Question understanding returned no result."
      );
    }

    let llmUnderstanding: Partial<LanguageUnderstanding>;

    try {
      llmUnderstanding = JSON.parse(
        content
      );
    } catch {
      throw new Error(
        "Question understanding returned invalid JSON."
      );
    }

    // ==========================================
    // 7. NORMALIZE LLM OUTPUT
    // ==========================================

    const understanding = {
      entity:
        typeof llmUnderstanding.entity ===
        "string"
          ? llmUnderstanding.entity.trim()
          : deterministic.entity,

      intent:
        llmUnderstanding.intent ||
        deterministic.intent,

      requested_field:
        llmUnderstanding.requested_field ||
        deterministic.requested_field,

      search_terms:
        Array.isArray(
          llmUnderstanding.search_terms
        )
          ? llmUnderstanding.search_terms
          : deterministic.search_terms,

      question_type:
        llmUnderstanding.question_type ||
        deterministic.question_type,

      confidence:
        deterministic.intent !== "unknown"
          ? Math.max(
              deterministic.confidence,
              0.85
            )
          : 0.75,

      method: "llm",
    };

    // ==========================================
    // 8. RETURN UNDERSTANDING
    // ==========================================

    return NextResponse.json({
      success: true,
      question,
      organizationId:
        profile.organization_id,
      understanding,
    });
  } catch (error: unknown) {
    console.error(
      "QUESTION UNDERSTANDING ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Question understanding failed.",
      },
      {
        status: 500,
      }
    );
  }
}