// src/lib/knowledge/language/classifier.ts

import {
  LOOKUP_VERBS,
  FIELD_ALIASES,
  INTENT_ALIASES,
} from "./vocabulary";

import {
  normalizeText,
  normalizeEntity,
  cleanDomainEntity,
} from "./normalize";

// ============================================================
// TYPES
// ============================================================

export type Intent =
  | "account_lookup"
  | "customer_lookup"
  | "employee_lookup"
  | "document_lookup"
  | "policy_lookup"
  | "procedure_lookup"
  | "financial_lookup"
  | "transaction_lookup"
  | "decision_lookup"
  | "project_lookup"
  | "date_filter"
  | "general_knowledge"
  | "unknown";

export type RequestedField =
  | "account_number"
  | "account_name"
  | "open_date"
  | "available_balance"
  | "uncleared_balance"
  | "customer_name"
  | "employee_name"
  | "department"
  | "contact"
  | "amount"
  | "date"
  | "policy"
  | "procedure"
  | "decision"
  | "unknown";

export type QuestionType =
  | "exact_lookup"
  | "list"
  | "comparison"
  | "explanation"
  | "summary"
  | "general_question"
  | "unknown";

export type DateFilterType =
  | "exact_date"
  | "month"
  | "year"
  | "annual"
  | "quarter"
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "this_year"
  | "last_year"
  | "past_days"
  | "date_filter"
  | "unknown";

export interface DateFilter {
  type: DateFilterType;
  value: string | null;
}

export interface LanguageUnderstanding {
  entity: string | null;
  intent: Intent;
  requested_field: RequestedField;
  search_terms: string[];
  question_type: QuestionType;
  date_filter: DateFilter | null;
  confidence: number;
  method: "deterministic" | "llm";
}

// ============================================================
// HELPERS
// ============================================================

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsAny(
  text: string,
  values: string[]
): boolean {
  return values.some((value) => {
    const normalized = normalizeText(value);

    if (!normalized) {
      return false;
    }

    if (normalized.includes(" ")) {
      return text.includes(normalized);
    }

    return new RegExp(
      `\\b${escapeRegex(normalized)}\\b`,
      "i"
    ).test(text);
  });
}

// ============================================================
// FIELD DETECTION
// ============================================================

function detectField(text: string): RequestedField {

  // ==========================================================
  // 1. UNCLEARED BALANCE
  // ==========================================================

  if (
    /\buncleared\s+(?:balance|amount|funds)\b/i.test(text) ||
    /\buncleared\b/i.test(text)
  ) {
    return "uncleared_balance";
  }

  // ==========================================================
  // 2. OPEN DATE
  // ==========================================================

  if (
    /\bopen\s+date\b/i.test(text) ||
    /\bopening\s+date\b/i.test(text) ||
    /\bdate\s+opened\b/i.test(text) ||
    /\bwhen\s+opened\b/i.test(text) ||
    /\bwhen\s+was\b.*\bopened\b/i.test(text) ||
    /\bwhen\s+did\b.*\bopen\b/i.test(text) ||
    /\baccount\s+opened\b/i.test(text) ||
    /\baccount\s+open\b/i.test(text)
  ) {
    return "open_date";
  }

  // ==========================================================
  // 3. ACCOUNT NUMBER
  // ==========================================================

  if (
    /\baccount\s+(?:number|no|#)\b/i.test(text) ||
    /\bacct\s+(?:number|no)\b/i.test(text) ||
    /\baccount\s+identifier\b/i.test(text)
  ) {
    return "account_number";
  }

  // ==========================================================
  // 4. AVAILABLE BALANCE
  // ==========================================================

  if (
    /\bavailable\s+balance\b/i.test(text) ||
    /\bcurrent\s+balance\b/i.test(text) ||
    /\bamount\s+available\b/i.test(text) ||
    /\bfunds\s+available\b/i.test(text) ||
    /\baccount\s+balance\b/i.test(text) ||
    /\bbalance\b/i.test(text)
  ) {
    return "available_balance";
  }

  // ==========================================================
  // 5. CONTACT / PHONE NUMBER
  // ==========================================================

  if (
    /\bcontact\s+number\b/i.test(text) ||
    /\bphone\s+number\b/i.test(text) ||
    /\btelephone\s+number\b/i.test(text) ||
    /\bmobile\s+number\b/i.test(text) ||
    /\bcontact\b/i.test(text) ||
    /\bphone\b/i.test(text) ||
    /\btelephone\b/i.test(text) ||
    /\bmobile\b/i.test(text)
  ) {
    return "contact";
  }

  // ==========================================================
  // 6. ACCOUNT NAME / ACCOUNT HOLDER
  // ==========================================================

  if (
    /\bname\s+on\b.*\baccount\b/i.test(text) ||
    /\bwhat\s+name\s+is\s+on\b.*\baccount\b/i.test(text) ||
    /\bwhose\s+name\b.*\baccount\b/i.test(text) ||
    /\bwho\s+owns\b.*\baccount\b/i.test(text) ||
    /\bwho\s+is\s+named\s+on\b.*\baccount\b/i.test(text) ||
    /\baccount\s+holder\s+name\b/i.test(text)
  ) {
    return "account_name";
  }

  // ==========================================================
  // 7. OTHER KNOWN FIELDS
  // ==========================================================

  const fields = Object.entries(FIELD_ALIASES);

  const sorted = fields.sort(
    ([, aliasesA], [, aliasesB]) =>
      Math.max(
        ...aliasesB.map((x) => x.length)
      ) -
      Math.max(
        ...aliasesA.map((x) => x.length)
      )
  );

  for (const [field, aliases] of sorted) {
    if (containsAny(text, aliases)) {
      return field as RequestedField;
    }
  }

  return "unknown";
}

// ============================================================
// INTENT DETECTION
// ============================================================

function detectIntent(
  text: string,
  field: RequestedField
): Intent {

  // ==========================================================
  // ACCOUNT FIELDS HAVE PRIORITY
  // ==========================================================

  if (
    field === "account_number" ||
    field === "account_name" ||
    field === "available_balance" ||
    field === "uncleared_balance" ||
    field === "open_date" ||
    field === "contact"
  ) {
    return "account_lookup";
  }

  // ==========================================================
  // TRANSACTION / PAYMENT PRIORITY
  // ==========================================================

  if (
    containsAny(text, INTENT_ALIASES.transaction_lookup)
  ) {
    return "transaction_lookup";
  }

  // ==========================================================
  // POLICY
  // ==========================================================

  if (field === "policy") {
    return "policy_lookup";
  }

  // ==========================================================
  // PROCEDURE
  // ==========================================================

  if (field === "procedure") {
    return "procedure_lookup";
  }

  // ==========================================================
  // DECISION
  // ==========================================================

  if (field === "decision") {
    return "decision_lookup";
  }

  // ==========================================================
  // EXPLICIT PROJECT ENTITY QUESTIONS
  // ==========================================================

  if (
    /\b(?:on|about|for)\s+.+\s+project\b/i.test(text)
  ) {
    return "project_lookup";
  }

  // ==========================================================
  // GENERAL ORGANIZATIONAL KNOWLEDGE
  // ==========================================================

  const generalOrganizationTerms = [

    // General knowledge

    "what do we know",
    "tell me about the organization",
    "tell me about our organization",
    "tell me about the company",
    "tell me about our company",
    "tell me what is known",
    "what do we currently know",
    "what information do we have",
    "what information is available",
    "what information has been captured",
    "what knowledge do we have",
    "what knowledge is available",
    "what knowledge has been captured",
    "what information is stored",
    "what organizational information do we have",
    "what company information is available",
    "what company information do we have",
    "what organizational knowledge is available",
    "what company knowledge is available",

    // OrgBrain-specific

    "what information is stored in orgbrain",
    "what knowledge is available in orgbrain",
    "what can orgbrain tell me",
    "what can orgbrain tell me about",
    "what can i learn about the organization from orgbrain",
    "what does orgbrain know",
    "what does orgbrain know about the organization",
    "what does orgbrain know about our organization",
    "what does orgbrain know about the company",
    "what knowledge is in orgbrain",
    "what information is in orgbrain",

    // Organizational overview

    "organizational information",
    "organisation information",
    "organizational knowledge",
    "organisation knowledge",
    "company information",
    "company knowledge",
    "organizational overview",
    "organisation overview",
    "company overview",
    "general overview",
    "general summary",

    // Captured organizational knowledge

    "knowledge captured about the organization",
    "knowledge captured about our company",
    "information captured about the organization",
    "information captured about our company",
  ];

  if (
    containsAny(
      text,
      generalOrganizationTerms
    )
  ) {
    return "general_knowledge";
  }

  // ==========================================================
  // BROAD ORGANIZATIONAL LIST / OVERVIEW
  // ==========================================================

  if (
    containsAny(text, [
      "departments",
      "department",
      "units",
      "projects",
      "policies",
      "procedures",
      "decisions",
      "employees",
      "staff",
    ]) &&
    containsAny(text, [
      "organization",
      "organisation",
      "company",
      "our",
      "we",
    ])
  ) {
    return "general_knowledge";
  }

  // ==========================================================
  // FINANCIAL QUESTIONS
  // ==========================================================

  const financialTerms = [
    "finance",
    "financial",
    "revenue",
    "profit",
    "loss",
    "income",
    "expense",
    "expenses",
    "capital",
    "investment",
    "investments",
    "money",
    "expenditure",
    "expenditures",
    "cash flow",
    "cashflow",
    "earnings",
    "turnover",
    "assets",
    "liabilities",
    "equity",
    "budget",
    "budgeting",
    "cost",
    "costs",
  ];

  if (
    containsAny(
      text,
      financialTerms
    )
  ) {
    return "financial_lookup";
  }

  // ==========================================================
  // OTHER KNOWN INTENT VOCABULARIES
  // ==========================================================

  for (
    const [intent, aliases]
    of Object.entries(
      INTENT_ALIASES
    )
  ) {
    if (
      containsAny(
        text,
        aliases
      )
    ) {
      return intent as Intent;
    }
  }

  return "unknown";
}

// ============================================================
// QUESTION TYPE
// ============================================================

function detectQuestionType(
  text: string,
  intent: Intent,
  field: RequestedField
): QuestionType {

  // ==========================================================
  // DATE FILTER
  // ==========================================================

  if (intent === "date_filter") {
    return "exact_lookup";
  }

  // ==========================================================
  // GENERAL KNOWLEDGE
  // ==========================================================

  if (intent === "general_knowledge") {

    if (
      /\b(summary|summarize|summarise|overview|brief|briefing)\b/i.test(text)
    ) {
      return "summary";
    }

    if (
      /\b(list|all|which|what are)\b/i.test(text)
    ) {
      return "list";
    }

    return "general_question";
  }

  // ==========================================================
  // EXACT DOMAIN LOOKUPS
  // ==========================================================

  if (
    
    intent === "account_lookup" ||
    intent === "customer_lookup" ||
    intent === "employee_lookup" ||
    intent === "transaction_lookup" ||
    intent === "document_lookup" ||
    intent === "policy_lookup" ||
    intent === "procedure_lookup" ||
    intent === "decision_lookup" ||
    intent === "project_lookup" ||
    intent === "financial_lookup" 
  ) {
    return "exact_lookup";
  }

  // ==========================================================
  // FIELD-BASED EXACT LOOKUP
  // ==========================================================

  if (
    intent !== "unknown" &&
    (
      field !== "unknown" ||
      intent === "account_lookup" ||
      intent === "customer_lookup" ||
      intent === "employee_lookup" ||
      intent === "transaction_lookup" ||
      intent === "document_lookup" ||
      intent === "policy_lookup" ||
      intent === "procedure_lookup" ||
      intent === "decision_lookup" ||
      intent === "project_lookup" ||
      intent === "financial_lookup"
    )
  ) {
    return "exact_lookup";
  }

  // ==========================================================
  // LIST
  // ==========================================================

  if (
    /\b(list|all|which|what are|show all|give me all)\b/i.test(text)
  ) {
    return "list";
  }

  // ==========================================================
  // COMPARISON
  // ==========================================================

  if (
    /\b(compare|comparison|difference|versus|vs|against)\b/i.test(text)
  ) {
    return "comparison";
  }

  // ==========================================================
  // EXPLANATION
  // ==========================================================

  if (
    /\b(why|explain|explanation|meaning|how does|how did|reason)\b/i.test(text)
  ) {
    return "explanation";
  }

  // ==========================================================
  // SUMMARY
  // ==========================================================

  if (
    /\b(summarize|summarise|summary|overview|brief|briefing)\b/i.test(text)
  ) {
    return "summary";
  }

  // ==========================================================
  // GENERAL QUESTION
  // ==========================================================

  if (
    /\b(what|how|why|when|where|who|which|can|could|does|do|is|are)\b/i.test(text)
  ) {
    return "general_question";
  }

  return "unknown";
}

// ============================================================
// REMOVE LOOKUP VERB
// ============================================================

function removeLeadingLookupVerb(
  question: string
): string {

  let value =
    question.trim();

  const compoundVerbPattern =
    /^(show\s+me|give\s+me|tell\s+me|provide\s+me|find\s+me|get\s+me)\s+/i;

  value =
    value.replace(
      compoundVerbPattern,
      ""
    );

  const verbPattern =
    /^(find|fetch|get|show|give|retrieve|lookup|look\s+up|provide|tell|check|search|locate|identify|display|return|bring|pull|obtain|access|view|see|know)\b\s*/i;

  value =
    value.replace(
      verbPattern,
      ""
    );

  value =
    value.replace(
      /^(please|can you|could you|would you|will you)\s+/i,
      ""
    );

  value =
    value.replace(
      /^(i\s+need|i\s+want|i\s+would\s+like)\s+/i,
      ""
    );

  return value.trim();
}

// ============================================================
// REMOVE QUESTION PREFIX
// ============================================================

function removeQuestionPrefix(
  question: string
): string {

  let value =
    question.trim();

  value =
    value.replace(
      /^(what\s+is|what's|what\s+are|who\s+is|who's|where\s+is|when\s+was|when\s+did|how\s+much|how\s+many|tell\s+me|give\s+me|show\s+me)\s+/i,
      ""
    );

  return value.trim();
}

// ============================================================
// FIELD PHRASES
// ============================================================

function getFieldAliases(
  field: RequestedField
): string[] {

  const aliases =
    FIELD_ALIASES[field];

  if (!aliases) {
    return [];
  }

  return [...aliases].sort(
    (a, b) =>
      b.length - a.length
  );
}

// ============================================================
// REMOVE FIELD FROM END
// ============================================================

function removeFieldFromEnd(
  value: string,
  field: RequestedField
): string {

  let result =
    value.trim();

  const aliases =
    getFieldAliases(field);

  for (
    const alias of aliases
  ) {

    const normalizedAlias =
      normalizeText(alias);

    if (!normalizedAlias) {
      continue;
    }

    const pattern =
      new RegExp(
        `\\s+${escapeRegex(normalizedAlias)}\\s*\\??$`,
        "i"
      );

    if (
      pattern.test(result)
    ) {
      result =
        result
          .replace(
            pattern,
            ""
          )
          .trim();

      break;
    }
  }

  return result;
}

// ============================================================
// REMOVE FIELD FROM BEGINNING
// ============================================================

function removeFieldFromBeginning(
  value: string,
  field: RequestedField
): string {

  let result =
    value.trim();

  const aliases =
    getFieldAliases(field);

  for (
    const alias of aliases
  ) {

    const normalizedAlias =
      normalizeText(alias);

    if (!normalizedAlias) {
      continue;
    }

    const pattern =
      new RegExp(
        `^${escapeRegex(normalizedAlias)}\\s+(?:of|for)\\s+`,
        "i"
      );

    if (
      pattern.test(result)
    ) {
      result =
        result
          .replace(
            pattern,
            ""
          )
          .trim();

      break;
    }
  }

  return result;
}

// ============================================================
// ENTITY CLEANUP
// ============================================================

function cleanExtractedEntity(
  value: string
): string {

  let result =
    value.trim();

  result =
    result
      .replace(
        /[?!.;,]+$/g,
        ""
      )
      .trim();

  result =
    result
      .replace(
        /['’]s$/i,
        ""
      )
      .trim();

  result =
    result
      .replace(
        /^(?:the|a|an)\s+/i,
        ""
      )
      .trim();

  return result;
}

// ============================================================
// ENTITY VALIDATION
// ============================================================

function isValidEntity(
  value: string
): boolean {

  const normalized =
    normalizeEntity(value);

  if (!normalized) {
    return false;
  }

  const invalidEntities =
    new Set([
      "account",
      "account number",
      "account no",
      "account #",
      "acct",
      "acct no",
      "acct number",
      "balance",
      "available balance",
      "current balance",
      "uncleared balance",
      "uncleared amount",
      "uncleared funds",
      "customer",
      "customer details",
      "client",
      "client details",
      "employee",
      "employee details",
      "staff",
      "staff details",
      "person",
      "personnel",
      "document",
      "documents",
      "file",
      "files",
      "policy",
      "policies",
      "procedure",
      "procedures",
      "transaction",
      "transactions",
    ]);

  return !invalidEntities.has(
    normalized
  );
}

// ============================================================
// DATE FILTER DETECTION
// ============================================================

function detectDateFilter(
  text: string
): DateFilter | null {

  const value =
    normalizeText(text);

  // ==========================================================
  // EXACT ISO DATE
  // Example: 2026-03-15
  // ==========================================================

  const isoDate =
    value.match(
      /\b(\d{4}-\d{2}-\d{2})\b/
    );

  if (isoDate?.[1]) {
    return {
      type: "exact_date",
      value: isoDate[1],
    };
  }

  // ==========================================================
  // EXACT WRITTEN DATE
  // Example: March 15, 2026
  // ==========================================================

  const writtenDate =
    value.match(
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(\d{4})\b/i
    );

  if (writtenDate?.[0]) {
    return {
      type: "exact_date",
      value: writtenDate[0],
    };
  }

  // ==========================================================
  // NUMERIC DATE
  // Example: 15/03/2026
  // ==========================================================

  const numericDate =
    value.match(
      /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/
    );

  if (numericDate?.[0]) {
    return {
      type: "exact_date",
      value: numericDate[0],
    };
  }

  // ==========================================================
  // QUARTER + YEAR
  //
  // Q1 2026
  // Q2 2026
  // Q3 2026
  // Q4 2026
  // ==========================================================

  const qNumber =
    value.match(
      /\bq([1-4])\s*(?:of\s+|[-/]?\s*)?(20\d{2})\b/i
    );

  if (
    qNumber?.[1] &&
    qNumber?.[2]
  ) {
    return {
      type: "quarter",
      value:
        `Q${qNumber[1]} ${qNumber[2]}`,
    };
  }

  // ==========================================================
  // FIRST / SECOND / THIRD / FOURTH QUARTER + YEAR
  // ==========================================================

  const namedQuarter =
    value.match(
      /\b(first|second|third|fourth)\s+quarter(?:\s+of)?\s+(20\d{2})\b/i
    );

  if (
    namedQuarter?.[1] &&
    namedQuarter?.[2]
  ) {

    const quarterMap: Record<string, string> = {
      first: "Q1",
      second: "Q2",
      third: "Q3",
      fourth: "Q4",
    };

    return {
      type: "quarter",
      value:
        `${quarterMap[namedQuarter[1].toLowerCase()]} ${namedQuarter[2]}`,
    };
  }

  // ==========================================================
  // THIS QUARTER
  // ==========================================================

  if (
    /\bthis quarter\b/i.test(value)
  ) {
    return {
      type: "this_quarter",
      value: "this quarter",
    };
  }

  // ==========================================================
  // LAST QUARTER
  // ==========================================================

  if (
    /\blast quarter\b/i.test(value)
  ) {
    return {
      type: "last_quarter",
      value: "last quarter",
    };
  }

  // ==========================================================
  // STANDALONE QUARTER
  //
  // Q1
  // first quarter
  // second quarter
  // etc.
  // ==========================================================

  const standaloneQuarter =
    value.match(
      /\bq([1-4])\b/i
    );

  if (
    standaloneQuarter?.[1]
  ) {
    return {
      type: "quarter",
      value:
        `Q${standaloneQuarter[1]}`,
    };
  }

  const standaloneNamedQuarter =
    value.match(
      /\b(first|second|third|fourth)\s+quarter\b/i
    );

  if (
    standaloneNamedQuarter?.[1]
  ) {

    const quarterMap: Record<string, string> = {
      first: "Q1",
      second: "Q2",
      third: "Q3",
      fourth: "Q4",
    };

    return {
      type: "quarter",
      value:
        quarterMap[
          standaloneNamedQuarter[1].toLowerCase()
        ],
    };
  }

  // ==========================================================
  // MONTH + YEAR
  // Example: March 2026
  // ==========================================================

  const monthYear =
    value.match(
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i
    );

  if (
    monthYear?.[0]
  ) {
    return {
      type: "month",
      value: monthYear[0],
    };
  }

  // ==========================================================
  // ANNUAL / YEARLY + YEAR
  //
  // annual 2026
  // annual report for 2026
  // yearly 2026
  // ==========================================================

  const annualYear =
    value.match(
      /\b(?:annual|yearly|year-end|year end)\b.*?\b(20\d{2})\b/i
    );

  if (
    annualYear?.[1]
  ) {
    return {
      type: "annual",
      value: annualYear[1],
    };
  }

  // ==========================================================
  // RELATIVE DATES
  // ==========================================================

  if (
    /\btoday\b/i.test(value)
  ) {
    return {
      type: "today",
      value: "today",
    };
  }

  if (
    /\byesterday\b/i.test(value)
  ) {
    return {
      type: "yesterday",
      value: "yesterday",
    };
  }

  if (
    /\bthis week\b/i.test(value)
  ) {
    return {
      type: "this_week",
      value: "this week",
    };
  }

  if (
    /\blast week\b/i.test(value)
  ) {
    return {
      type: "last_week",
      value: "last week",
    };
  }

  if (
    /\bthis month\b/i.test(value)
  ) {
    return {
      type: "this_month",
      value: "this month",
    };
  }

  if (
    /\blast month\b/i.test(value)
  ) {
    return {
      type: "last_month",
      value: "last month",
    };
  }

  if (
    /\bthis year\b/i.test(value)
  ) {
    return {
      type: "this_year",
      value: "this year",
    };
  }

  if (
    /\blast year\b/i.test(value)
  ) {
    return {
      type: "last_year",
      value: "last year",
    };
  }

  // ==========================================================
  // PAST / LAST N DAYS
  // ==========================================================

  const pastDays =
    value.match(
      /\b(?:past|last)\s+(\d+)\s+days?\b/i
    );

  if (
    pastDays?.[1]
  ) {
    return {
      type: "past_days",
      value: pastDays[1],
    };
  }

  // ==========================================================
  // YEAR
  // Example: 2026
  // ==========================================================

  const year =
    value.match(
      /\b(20\d{2})\b/
    );

  if (
    year?.[1]
  ) {
    return {
      type: "year",
      value: year[1],
    };
  }

  return null;
}

// ============================================================
// ENTITY EXTRACTION
// ============================================================

function extractEntity(
  originalQuestion: string,
  field: RequestedField,
  intent: Intent
): string | null {

  let value =
    originalQuestion
      .trim()
      .replace(/\?+$/, "")
      .trim();

  console.log(
    "POLICY ENTITY DEBUG:",
    {
      originalQuestion,
      value,
      intent,
      field,
    }
  );

  // ==========================================================
  // DATE-ONLY QUESTIONS HAVE NO ENTITY
  // ==========================================================

  if (
    intent === "date_filter"
  ) {
    return null;
  }

  // ==========================================================
  // GENERAL ORGANIZATIONAL QUESTIONS WITHOUT AN ENTITY
  // ==========================================================

  if (
    intent === "general_knowledge"
  ) {

    const genericGeneralQuestionPatterns = [

      // ORGANIZATION

      /^what\s+do\s+we\s+know\s+about\s+(?:the\s+)?organization$/i,
      /^tell\s+me\s+about\s+(?:the\s+)?organization$/i,
      /^what\s+information\s+do\s+we\s+have\s+about\s+(?:the\s+)?organization$/i,
      /^show\s+me\s+what\s+we\s+know\s+about\s+(?:the\s+)?company$/i,
      /^tell\s+me\s+what\s+is\s+known\s+about\s+(?:the\s+)?organization$/i,
      /^what\s+do\s+we\s+currently\s+know\s+about\s+(?:the\s+)?organization$/i,
      /^what\s+information\s+has\s+been\s+captured\s+about\s+(?:the\s+)?organization$/i,

      // COMPANY

      /^what\s+do\s+we\s+know\s+about\s+our\s+company$/i,
      /^what\s+information\s+do\s+we\s+have\s+about\s+our\s+company$/i,
      /^what\s+company\s+information\s+is\s+available$/i,
      /^what\s+company\s+knowledge\s+is\s+available$/i,
      /^what\s+knowledge\s+has\s+been\s+captured\s+about\s+our\s+company$/i,

      // ORGANIZATIONAL KNOWLEDGE

      /^what\s+knowledge\s+is\s+available\s+in\s+(?:the\s+)?organization$/i,
      /^what\s+organizational\s+information\s+do\s+we\s+have$/i,
      /^what\s+organizational\s+knowledge\s+is\s+available$/i,
      /^what\s+information\s+is\s+available\s+across\s+(?:the\s+)?organization$/i,

      // ORGBRAIN

      /^what\s+information\s+is\s+stored\s+in\s+orgbrain$/i,
      /^what\s+knowledge\s+is\s+available\s+in\s+orgbrain$/i,
      /^what\s+knowledge\s+is\s+in\s+orgbrain$/i,
      /^what\s+information\s+is\s+in\s+orgbrain$/i,
      /^what\s+does\s+orgbrain\s+know$/i,
      /^what\s+does\s+orgbrain\s+know\s+about\s+(?:the\s+)?organization$/i,
      /^what\s+does\s+orgbrain\s+know\s+about\s+our\s+organization$/i,
      /^what\s+does\s+orgbrain\s+know\s+about\s+the\s+company$/i,
      /^what\s+can\s+orgbrain\s+tell\s+me\s+about\s+(?:the\s+)?organization$/i,
      /^what\s+can\s+orgbrain\s+tell\s+me\s+about\s+our\s+organization$/i,
      /^what\s+can\s+i\s+learn\s+about\s+(?:the\s+)?organization\s+from\s+orgbrain$/i,

      // OVERVIEW

      /^give\s+me\s+an?\s+overview\s+of\s+(?:the\s+)?organization$/i,
      /^give\s+me\s+(?:a\s+)?general\s+overview\s+of\s+(?:the\s+)?organization$/i,
      /^give\s+me\s+(?:a\s+)?general\s+overview\s+of\s+our\s+company$/i,
      /^give\s+me\s+an?\s+overview\s+of\s+the\s+knowledge\s+in\s+orgbrain$/i,

      // SUMMARY

      /^give\s+me\s+a\s+summary\s+of\s+what\s+we\s+know\s+about\s+(?:the\s+)?organization$/i,
      /^give\s+me\s+a\s+summary\s+of\s+our\s+organizational\s+knowledge$/i,
      /^give\s+me\s+a\s+general\s+summary\s+of\s+what\s+orgbrain\s+knows$/i,
      /^give\s+me\s+a\s+summary\s+of\s+what\s+we\s+know$/i,
    ];

    if (
      genericGeneralQuestionPatterns.some(
        (pattern) =>
          pattern.test(value)
      )
    ) {
      return null;
    }

    const broadGeneralStructurePatterns = [
      /^show\s+me\s+what\s+we\s+know\s+about\s+(?:the\s+)?(?:company|organization)$/i,

      /^give\s+me\s+(?:an?\s+)?overview\s+of\s+(?:the\s+)?(?:company|organization)$/i,

      /^give\s+me\s+(?:a\s+)?summary\s+of\s+what\s+we\s+know\s+about\s+(?:the\s+)?(?:company|organization)$/i,

      /^give\s+me\s+(?:an?\s+)?overview\s+of\s+the\s+knowledge\s+in\s+orgbrain$/i,
    ];

    if (
      broadGeneralStructurePatterns.some(
        (pattern) =>
          pattern.test(value)
      )
    ) {
      return null;
    }
  }

  // ==========================================================
  // POLICY ENTITY EXTRACTION
  // ==========================================================

  if (
    intent === "policy_lookup"
  ) {

    let match =
      value.match(
        /^tell\s+me\s+about\s+(?:the\s+)?(.+?)\s+policy$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:find|show\s+me|show)\s+(?:the\s+)?policy\s+record\s+for\s+(.+?)\s+policy$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^give\s+me\s+(?:the\s+)?policy\s+information\s+for\s+(.+?)\s+policy$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:find|show\s+me|show)\s+(?:the\s+)?policy\s+for\s+(.+?)\s+policy$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^tell\s+me\s+(?:the\s+)?(.+?)\s+policy\s+(?:details?|records?|information)$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:find|get|show\s+me|show|retrieve|lookup|look\s+up|fetch|provide|give\s+me|check|what\s+is|what\s+are)\s+(?:the\s+)?(?:company's\s+)?(.+?)\s+policy(?:\s+(?:details?|records?|information))?$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:i\s+need|i\s+want|i\s+would\s+like)\s+(?:the\s+)?(.+?)\s+policy(?:\s+(?:details?|records?|information))?$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^what\s+policy\s+information\s+do\s+we\s+have\s+for\s+(.+?)\s+policy$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^what\s+information\s+do\s+we\s+have\s+(?:on|for)\s+(.+?)\s+policy$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }
  }

  // ==========================================================
  // PROCEDURE / PROCESS ENTITY EXTRACTION
  // ==========================================================

  if (
    intent === "procedure_lookup"
  ) {

    let match =
      value.match(
        /^tell\s+me\s+about\s+(?:the\s+)?(.+?)\s+procedure$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:find|show\s+me|show)\s+(?:the\s+)?procedure\s+record\s+for\s+(.+?)\s+procedure$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^give\s+me\s+(?:the\s+)?procedure\s+information\s+for\s+(.+?)\s+procedure$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:find|show\s+me|show)\s+(?:the\s+)?procedure\s+for\s+(.+?)\s+procedure$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:find|get|show\s+me|show|retrieve|lookup|look\s+up|fetch|provide|give\s+me|check|what\s+is|what\s+are)\s+(?:the\s+)?(?:company's\s+)?(.+?)\s+procedure(?:\s+(?:details?|records?|information))?$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^tell\s+me\s+(?:the\s+)?(.+?)\s+procedure\s+(?:details?|records?|information)$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:i\s+need|i\s+want|i\s+would\s+like)\s+(?:the\s+)?(.+?)\s+procedure(?:\s+(?:details?|records?|information))?$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^what\s+procedure\s+information\s+do\s+we\s+have\s+for\s+(.+?)\s+procedure$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^what\s+information\s+do\s+we\s+have\s+(?:on|for)\s+(.+?)\s+procedure$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }
  }

  // ==========================================================
  // DECISION / APPROVAL ENTITY EXTRACTION
  // ==========================================================

  if (
    intent === "decision_lookup"
  ) {

    let match =
      value.match(
        /^tell\s+me\s+about\s+(?:the\s+)?(.+?)\s+decision$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:find|show\s+me|show)\s+(?:the\s+)?decision\s+record\s+for\s+(.+?)\s+decision$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^give\s+me\s+(?:the\s+)?decision\s+information\s+for\s+(.+?)\s+decision$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:find|show\s+me|show)\s+(?:the\s+)?decision\s+for\s+(.+?)\s+decision$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:find|get|show\s+me|show|retrieve|lookup|look\s+up|fetch|provide|give\s+me|check|what\s+is|what\s+are)\s+(?:the\s+)?(?:company's\s+)?(.+?)\s+decision(?:\s+(?:details?|records?|information))?$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^tell\s+me\s+(?:the\s+)?(.+?)\s+decision\s+(?:details?|records?|information)$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:i\s+need|i\s+want|i\s+would\s+like)\s+(?:the\s+)?(.+?)\s+decision(?:\s+(?:details?|records?|information))?$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^what\s+decision\s+information\s+do\s+we\s+have\s+for\s+(.+?)\s+decision$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^what\s+information\s+do\s+we\s+have\s+(?:on|for)\s+(.+?)\s+decision$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }
  }

  // ==========================================================
  // PROJECT / INITIATIVE ENTITY EXTRACTION
  // ==========================================================

  if (
    intent === "project_lookup"
  ) {

    console.log(
      "========== PROJECT ENTITY BLOCK =========="
    );

    console.log({
      originalQuestion,
      value,
      intent,
      field,
    });

    let match =
      value.match(
        /^tell\s+me\s+about\s+(?:the\s+)?(.+?)\s+project$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:find|show\s+me|show)\s+(?:the\s+)?project\s+record\s+for\s+(.+?)\s+project$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^tell\s+me\s+(?:the\s+)?(.+?)\s+project$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:find|show\s+me|show)\s+(?:the\s+)?project\s+record\s+for\s+(.+?)$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1].replace(
            /\s+project$/i,
            ""
          )
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^give\s+me\s+(?:the\s+)?project\s+information\s+for\s+(.+?)\s+project$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:find|show\s+me|show)\s+(?:the\s+)?project\s+for\s+(.+?)\s+project$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:find|get|show\s+me|show|retrieve|lookup|look\s+up|fetch|provide|give\s+me|check|what\s+is|what\s+are)\s+(?:the\s+)?(?:company's\s+)?(.+?)\s+project(?:\s+(?:details?|records?|information))?$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^tell\s+me\s+(?:the\s+)?(.+?)\s+project\s+(?:details?|records?|information)$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^(?:i\s+need|i\s+want|i\s+would\s+like)\s+(?:the\s+)?(.+?)\s+project(?:\s+(?:details?|records?|information))?$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^what\s+project\s+information\s+do\s+we\s+have\s+for\s+(.+?)\s+project$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^what\s+information\s+do\s+we\s+have\s+(?:on|for)\s+(.+?)\s+project$/i
      );

    if (match?.[1]) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }
  }

  // ==========================================================
  // TRANSACTION / PAYMENT ENTITY EXTRACTION
  // ==========================================================

  if (
    intent === "transaction_lookup"
  ) {

    // FIX #20

    if (
      /^tell\s+me\s+about\s+(.+?)['’]s\s+transactions?$/i.test(
        value
      )
    ) {
      const match =
        value.match(
          /^tell\s+me\s+about\s+(.+?)['’]s\s+transactions?$/i
        );

      if (match?.[1]) {
        return normalizeEntity(
          match[1].trim()
        );
      }
    }

    // FIX #23

    if (
      /^what\s+information\s+do\s+we\s+have\s+on\s+(.+?)['’]s\s+transactions?$/i.test(
        value
      )
    ) {
      const match =
        value.match(
          /^what\s+information\s+do\s+we\s+have\s+on\s+(.+?)['’]s\s+transactions?$/i
        );

      if (match?.[1]) {
        return normalizeEntity(
          match[1].trim()
        );
      }
    }

    // FIX #24

    if (
      /^(?:give\s+me|show\s+me|tell\s+me|get|find|retrieve|i\s+need|i\s+want|i\s+would\s+like)\s+(.+?)['’]s\s+transaction\s+(?:record|details?)?$/i.test(
        value
      )
    ) {
      const match =
        value.match(
          /^(?:give\s+me|show\s+me|tell\s+me|get|find|retrieve|i\s+need|i\s+want|i\s+would\s+like)\s+(.+?)['’]s\s+transaction\s+(?:record|details?)?$/i
        );

      if (match?.[1]) {
        return normalizeEntity(
          match[1].trim()
        );
      }
    }

    // A. ENTITY + TRANSACTION/PAYMENT

    const entityFirstMatch =
      value.match(
        /^(?:find|show\s+me|show|find\s+me|get|retrieve|lookup|look\s+up|fetch|provide|give\s+me|tell\s+me|check|what\s+is|what\s+are)\s+(?:the\s+)?(.+?)\s+(?:transaction|transactions|payment|payments)(?:\s+(?:detail|details|record|records|information))?$/i
      );

    if (
      entityFirstMatch?.[1]
    ) {
      const entity =
        entityFirstMatch[1].trim();

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    // B. TRANSACTION/PAYMENT + FOR/ON + ENTITY

    const entityLastMatch =
      value.match(
        /^(?:find|show\s+me|show|find\s+me|get|retrieve|lookup|look\s+up|fetch|provide|give\s+me|tell\s+me|check)\s+(?:the\s+)?(?:transaction|transactions|payment|payments)\s+(?:detail|details|record|records|information)\s+(?:for|of|on)\s+(.+?)$/i
      );

    if (
      entityLastMatch?.[1]
    ) {
      const entity =
        entityLastMatch[1].trim();

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    // C. TRANSACTION INFORMATION + FOR/ON + ENTITY

    const transactionInfoMatch =
      value.match(
        /^what\s+transaction\s+(?:information|details|records?)\s+(?:do\s+we\s+have|do\s+you\s+have)\s+(?:for|on)\s+(.+?)$/i
      );

    if (
      transactionInfoMatch?.[1]
    ) {
      const entity =
        transactionInfoMatch[1].trim();

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    // D. POSSESSIVE TRANSACTION/PAYMENT

    const possessiveMatch =
      value.match(
        /^(?:tell\s+me\s+about|what\s+information\s+do\s+we\s+have\s+(?:on|for)|give\s+me|show\s+me|tell\s+me|get|find|retrieve|i\s+need|i\s+want|i\s+would\s+like)\s+(.+?)['’]s\s+(?:transaction|transactions|payment|payments)(?:\s+(?:detail|details|record|records|information))?$/i
      );

    if (
      possessiveMatch?.[1]
    ) {
      const entity =
        possessiveMatch[1].trim();

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    // E. DIRECT ABOUT TRANSACTIONS

    const aboutMatch =
      value.match(
        /^tell\s+me\s+about\s+(.+?)['’]s\s+(?:transaction|transactions|payment|payments)?$/i
      );

    if (
      aboutMatch?.[1]
    ) {
      const entity =
        aboutMatch[1].trim();

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }
  }

  // ==========================================================
  // DOCUMENT / FILE ENTITY EXTRACTION
  // ==========================================================

  if (
    intent === "document_lookup"
  ) {

    const tellAboutDocumentMatch =
      value.match(
        /^tell\s+me\s+about\s+(?:the\s+)?(.+?)\s+(?:document|documents|file|files)(?:\s+(?:detail|details|record|records|information))?$/i
      );

    if (
      tellAboutDocumentMatch?.[1]
    ) {
      const entity =
        cleanExtractedEntity(
          cleanDomainEntity(
            tellAboutDocumentMatch[1]
          )
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    const entityFirstMatch =
      value.match(
        /^(?:find|show\s+me|show|find\s+me|get|retrieve|lookup|look\s+up|fetch|provide|give\s+me|tell\s+me|check|what\s+is|what\s+are)\s+(?:the\s+)?(.+?)\s+(?:document|documents|file|files)(?:\s+(?:detail|details|record|records|information))?$/i
      );

    if (
      entityFirstMatch?.[1]
    ) {
      const entity =
        cleanExtractedEntity(
          cleanDomainEntity(
            entityFirstMatch[1]
          )
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    const entityLastMatch =
      value.match(
        /^(?:find|show\s+me|show|find\s+me|get|retrieve|lookup|look\s+up|fetch|provide|give\s+me|tell\s+me|check)\s+(?:the\s+)?(?:document|documents|file|files)\s+(?:detail|details|record|records|information)\s+(?:for|of|on)\s+(.+?)$/i
      );

    if (
      entityLastMatch?.[1]
    ) {
      const entity =
        cleanExtractedEntity(
          cleanDomainEntity(
            entityLastMatch[1]
          )
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    const documentInfoMatch =
      value.match(
        /^what\s+document\s+(?:information|details|records?)\s+do\s+we\s+have\s+(?:for|on)\s+(.+?)$/i
      );

    if (
      documentInfoMatch?.[1]
    ) {
      const entity =
        cleanExtractedEntity(
          cleanDomainEntity(
            documentInfoMatch[1]
          )
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    const informationMatch =
      value.match(
        /^what\s+information\s+do\s+we\s+have\s+(?:on|for)\s+(.+?)$/i
      );

    if (
      informationMatch?.[1]
    ) {
      const entity =
        cleanExtractedEntity(
          cleanDomainEntity(
            informationMatch[1]
          )
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    const aboutDocumentMatch =
      value.match(
        /^tell\s+me\s+about\s+(?:the\s+)?(.+?)\s+(?:document|documents|file|files)(?:\s+(?:detail|details|record|records|information))?$/i
      );

    if (
      aboutDocumentMatch?.[1]
    ) {
      const entity =
        cleanExtractedEntity(
          cleanDomainEntity(
            aboutDocumentMatch[1]
          )
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    const simpleAboutMatch =
      value.match(
        /^tell\s+me\s+about\s+(?:the\s+)?(.+?)$/i
      );

    if (
      simpleAboutMatch?.[1]
    ) {
      const entity =
        cleanExtractedEntity(
          cleanDomainEntity(
            simpleAboutMatch[1]
          )
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    const needDocumentMatch =
      value.match(
        /^(?:i\s+need|i\s+want|i\s+would\s+like)\s+(?:the\s+)?(.+?)\s+(?:document|documents|file|files)(?:\s+(?:detail|details|record|records|information))?$/i
      );

    if (
      needDocumentMatch?.[1]
    ) {
      const entity =
        cleanExtractedEntity(
          cleanDomainEntity(
            needDocumentMatch[1]
          )
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }
  }

  // ==========================================================
  // GENERAL ORGANIZATIONAL ENTITY EXTRACTION
  // ==========================================================

  if (
    intent === "general_knowledge"
  ) {

    let match =
      value.match(
        /^what\s+information\s+do\s+we\s+have\s+(?:on|about|for)\s+(.+?)$/i
      );

    if (
      match?.[1]
    ) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    match =
      value.match(
        /^what\s+do\s+we\s+know\s+(?:about|on)\s+(.+?)$/i
      );

    if (
      match?.[1]
    ) {
      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }
  }

  // ==========================================================
  // FIELD + OF/FOR + ENTITY
  // ==========================================================

  const fieldAliases =
    getFieldAliases(field);

  if (
    fieldAliases.length > 0
  ) {

    const fieldPattern =
      fieldAliases
        .map(escapeRegex)
        .join("|");

    const fieldOfForRegex =
      new RegExp(
        `(?:^|\\s)(?:${fieldPattern})\\s+(?:of|for)\\s+(.+?)$`,
        "i"
      );

    const fieldOfForMatch =
      value.match(
        fieldOfForRegex
      );

    if (
      fieldOfForMatch?.[1]
    ) {

      const entity =
        cleanExtractedEntity(
          fieldOfForMatch[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }
  }

  // ==========================================================
  // NATURAL OPENING-DATE QUESTIONS
  // ==========================================================

  if (
    field === "open_date"
  ) {

    const openingDatePatterns = [
      /^(?:when\s+was)\s+(.+?)\s+(?:account\s+)?opened$/i,

      /^(?:when\s+did)\s+(.+?)\s+open\s+(?:the\s+)?account$/i,

      /^(?:when\s+was)\s+(.+?)['’]s\s+account\s+opened$/i,

      /^(?:when\s+did)\s+(.+?)\s+open\s+(?:his|her|their)\s+account$/i,
    ];

    for (
      const pattern of openingDatePatterns
    ) {

      const match =
        value.match(
          pattern
        );

      if (
        match?.[1]
      ) {

        const entity =
          cleanExtractedEntity(
            match[1]
          );

        if (
          entity &&
          isValidEntity(entity)
        ) {
          return normalizeEntity(
            entity
          );
        }
      }
    }
  }

  // ==========================================================
  // NATURAL ACCOUNT-NAME QUESTIONS
  // ==========================================================

  if (
    field === "account_name"
  ) {

    value =
      value
        .replace(
          /^(?:i\s+need|i\s+want|i\s+would\s+like)\s+/i,
          ""
        )
        .trim();

    const accountNamePatterns = [
      /^(?:the\s+)?name\s+on\s+(.+?)['’]s\s+account$/i,

      /^what\s+name\s+is\s+on\s+(.+?)['’]s\s+account$/i,

      /^what\s+is\s+the\s+name\s+on\s+(.+?)(?:['’]s)?\s+account$/i,

      /^show\s+me\s+the\s+name\s+on\s+(.+?)(?:['’]s)?\s+account$/i,

      /^tell\s+me\s+the\s+name\s+on\s+(.+?)(?:['’]s)?\s+account$/i,

      /^give\s+me\s+the\s+name\s+on\s+(.+?)(?:['’]s)?\s+account$/i,

      /^whose\s+name\s+is\s+on\s+(.+?)(?:['’]s)?\s+account$/i,

      /^who\s+owns\s+(?:the\s+)?account\s+(?:for|of)\s+(.+)$/i,

      /^who\s+is\s+named\s+on\s+(.+?)(?:['’]s)?\s+account$/i,

      /^account\s+holder\s+name\s+(?:for|of)\s+(.+)$/i,
    ];

    for (
      const pattern of accountNamePatterns
    ) {

      const match =
        value.match(
          pattern
        );

      if (
        match?.[1]
      ) {

        const entity =
          cleanExtractedEntity(
            match[1]
          );

        if (
          entity &&
          isValidEntity(entity)
        ) {
          return normalizeEntity(
            entity
          );
        }
      }
    }
  }

  // ==========================================================
  // NATURAL CUSTOMER / CLIENT QUESTIONS
  // ==========================================================

  if (
    field === "customer_name"
  ) {

    const customerPatterns = [

      /^(?:show\s+me|find|get|retrieve|lookup|look\s+up|fetch|provide|give\s+me|tell\s+me|check)\s+(?:the\s+)?(?:customer|client)\s+(?:record|details|information)\s+(?:for|of)\s+(.+?)$/i,

      /^(?:customer|client)\s+(?:record|details|information)\s+(?:for|of)\s+(.+?)$/i,

      /^(?:show\s+me|show|find|get|retrieve|lookup|look\s+up|fetch|provide|give\s+me|tell\s+me|check)\s+(?:the\s+)?(.+?)\s+(?:customer|client)\s+(?:details|information|record)$/i,

      /^(?:what\s+is|what\s+are)\s+(.+?)\s+(?:customer|client)\s+(?:details|information|record)?$/i,

      /^(?:what\s+)?(?:customer|client)\s+(?:information|details)\s+(?:do\s+we\s+have|do\s+you\s+have)\s+(?:for|on)\s+(.+?)$/i,

      /^(?:what\s+)?information\s+(?:do\s+we\s+have|do\s+you\s+have)\s+(?:on|for)\s+(.+?)\s+as\s+(?:a\s+)?(?:customer|client)?$/i,

      /^(?:tell\s+me)\s+about\s+(.+?)\s+as\s+(?:a\s+)?(?:customer|client)?$/i,

      /^(?:give\s+me|show\s+me|tell\s+me|get|find|retrieve)\s+(.+?)['’]s\s+(?:customer|client)\s+(?:record|details|information)$/i,

      /^(?:i\s+need|i\s+want|i\s+would\s+like)\s+(.+?)['’]s\s+(?:customer|client)\s+(?:record|details|information)$/i,
    ];

    for (
      const pattern of customerPatterns
    ) {

      const match =
        value.match(
          pattern
        );

      if (
        match?.[1]
      ) {

        const entity =
          cleanExtractedEntity(
            match[1]
          );

        if (
          entity &&
          isValidEntity(entity)
        ) {
          return normalizeEntity(
            entity
          );
        }
      }
    }
  }

  // ==========================================================
  // NATURAL EMPLOYEE / STAFF QUESTIONS
  // ==========================================================

  if (
    field === "employee_name"
  ) {

    const employeePatterns = [

      /^(?:find|show\s+me|show|find\s+me|get|retrieve|lookup|look\s+up|fetch|provide|give\s+me|tell\s+me|check)\s+(?:the\s+)?(?:employee|staff)\s+(?:record|details|information)\s+(?:for|of)\s+(.+?)$/i,

      /^(?:find|show\s+me|show|find\s+me|get|retrieve|lookup|look\s+up|fetch|provide|give\s+me|tell\s+me|check)\s+(?:the\s+)?(.+?)\s+(?:employee|staff)\s+(?:details|information|record)$/i,

      /^(?:what\s+is|what\s+are)\s+(.+?)\s+(?:employee|staff)\s+(?:details|information|record)?$/i,

      /^(?:what\s+)?(?:employee|staff)\s+(?:information|details)\s+(?:do\s+we\s+have|do\s+you\s+have)\s+(?:for|on)\s+(.+?)$/i,

      /^(?:what\s+)?information\s+(?:do\s+we\s+have|do\s+you\s+have)\s+(?:on|for)\s+(.+?)\s+as\s+(?:an\s+employee|a\s+staff\s+member|staff)?$/i,

      /^(?:tell\s+me)\s+about\s+(.+?)\s+as\s+(?:an\s+employee|a\s+staff\s+member|staff)?$/i,

      /^(?:give\s+me|show\s+me|tell\s+me|get|find|retrieve)\s+(.+?)['’]s\s+(?:employee|staff)\s+(?:record|details|information)$/i,

      /^(?:i\s+need|i\s+want|i\s+would\s+like)\s+(.+?)['’]s\s+(?:employee|staff)\s+(?:record|details|information)$/i,
    ];

    for (
      const pattern of employeePatterns
    ) {

      const match =
        value.match(
          pattern
        );

      if (
        match?.[1]
      ) {

        const entity =
          cleanExtractedEntity(
            match[1]
          );

        if (
          entity &&
          isValidEntity(entity)
        ) {
          return normalizeEntity(
            entity
          );
        }
      }
    }
  }

  // ==========================================================
  // COMPLEX ACCOUNT / ENTITY EXTRACTION
  // ==========================================================

  if (
    intent === "account_lookup"
  ) {

    let match: RegExpMatchArray | null =
      null;

    // 1. ACCOUNT + NUMBER + NUMERIC IDENTIFIER

    match =
      value.match(
        /\baccount\s+(?:with\s+number|number|no\.?|#)\s+([0-9]{4,})\b/i
      );

    if (
      match?.[1]
    ) {
      return normalizeEntity(
        match[1]
      );
    }

    // 2. ACCOUNT + NUMERIC IDENTIFIER

    match =
      value.match(
        /\baccount\b.*?\b([0-9]{6,})\b/i
      );

    if (
      match?.[1]
    ) {
      return normalizeEntity(
        match[1]
      );
    }

    // 3. ACCOUNT BELONGING TO ENTITY

    match =
      value.match(
        /\baccount(?:\s+(?:record|details|information))?\s+belonging\s+to\s+(.+?)$/i
      );

    if (
      match?.[1]
    ) {

      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    // 4. ACCOUNT REGISTERED UNDER ENTITY

    match =
      value.match(
        /\baccount(?:\s+(?:record|details|information))?\s+registered\s+under\s+(.+?)$/i
      );

    if (
      match?.[1]
    ) {

      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    // 5. ACCOUNT ASSOCIATED WITH ENTITY

    match =
      value.match(
        /\baccount(?:\s+(?:record|details|information))?\s+associated\s+with\s+(.+?)$/i
      );

    if (
      match?.[1]
    ) {

      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    // 6. ACCOUNT DETAILS / INFORMATION FOR ENTITY

    match =
      value.match(
        /\baccount(?:\s+(?:details|information|record))?\s+for\s+(.+?)$/i
      );

    if (
      match?.[1]
    ) {

      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    // 7. ENTITY'S SAVINGS ACCOUNT

    match =
      value.match(
        /^(.+?)['’]s\s+(?:savings\s+)?account$/i
      );

    if (
      match?.[1]
    ) {

      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    // 8. ENTITY'S ACCOUNT DETAILS / INFORMATION

    match =
      value.match(
        /^(.+?)['’]s\s+account\s+(?:details|information|record)$/i
      );

    if (
      match?.[1]
    ) {

      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    // 9. ACCOUNT BELONGS TO ENTITY

    match =
      value.match(
        /\baccount\s+belongs?\s+to\s+(.+?)$/i
      );

    if (
      match?.[1]
    ) {

      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    // 10. WHICH ACCOUNT DOES ENTITY HAVE?

    match =
      value.match(
        /^what\s+account\s+does\s+(.+?)\s+have$/i
      );

    if (
      match?.[1]
    ) {

      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }

    // 11. SAVINGS DEPOSIT BELONGING TO ENTITY

    match =
      value.match(
        /\bsavings\s+deposit\s+belonging\s+to\s+(.+?)$/i
      );

    if (
      match?.[1]
    ) {

      const entity =
        cleanExtractedEntity(
          match[1]
        );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(
          entity
        );
      }
    }
  }

  // ==========================================================
  // 2. REMOVE POLITE PREFIXES
  // ==========================================================

  value =
    value
      .replace(
        /^(?:can|could|would|will)\s+you\s+/i,
        ""
      )
      .replace(
        /^please\s+/i,
        ""
      )
      .replace(
        /^(?:i\s+need|i\s+want|i\s+would\s+like)\s+/i,
        ""
      )
      .trim();

  // ==========================================================
  // 3. COMPOUND / DIRECT LOOKUP VERBS
  // ==========================================================

  const compoundLookupPrefix =
    /^(?:show\s+me|show|give\s+me|tell\s+me|provide\s+me|find\s+me|get\s+me)\s+/i;

  if (
    compoundLookupPrefix.test(value)
  ) {

    value =
      value
        .replace(
          compoundLookupPrefix,
          ""
        )
        .trim();

    value =
      removeFieldFromEnd(
        value,
        field
      );

    value =
      cleanExtractedEntity(
        value
      );

    if (
      value &&
      isValidEntity(value)
    ) {
      return normalizeEntity(
        value
      );
    }
  }

  // ==========================================================
  // 4. SINGLE LOOKUP VERBS
  // ==========================================================

  const lookupPrefix =
    /^(?:find|fetch|get|retrieve|lookup|look\s+up|provide|check|search|locate|identify|display|return|bring|pull|obtain|access|view|see|know)\s+/i;

  if (
    lookupPrefix.test(value)
  ) {

    value =
      value
        .replace(
          lookupPrefix,
          ""
        )
        .trim();

    value =
      value
        .replace(
          /^please\s+/i,
          ""
        )
        .trim();

    value =
      removeFieldFromEnd(
        value,
        field
      );

    value =
      cleanExtractedEntity(
        value
      );

    if (
      value &&
      isValidEntity(value)
    ) {
      return normalizeEntity(
        value
      );
    }
  }

  // ==========================================================
  // 5. POSSESSIVE QUESTION
  // ==========================================================

  const possessiveRegex =
    /^(?:what\s+is|what's|what\s+are|who\s+is|who's|tell\s+me|give\s+me|show\s+me)\s+(.+?)['’]s\s+/i;

  const possessiveMatch =
    value.match(
      possessiveRegex
    );

  if (
    possessiveMatch?.[1]
  ) {

    const entity =
      cleanExtractedEntity(
        possessiveMatch[1]
      );

    if (
      entity &&
      isValidEntity(entity)
    ) {
      return normalizeEntity(
        entity
      );
    }
  }

  // ==========================================================
  // 6. SIMPLE ENTITY + FIELD
  // ==========================================================

  let entityWithField =
    removeFieldFromEnd(
      value,
      field
    );

  entityWithField =
    entityWithField
      .replace(
        /^(?:what\s+is|what's|who\s+is|who's)\s+/i,
        ""
      )
      .trim();

  entityWithField =
    cleanExtractedEntity(
      entityWithField
    );

  if (
    entityWithField &&
    entityWithField !== value &&
    isValidEntity(entityWithField)
  ) {
    return normalizeEntity(
      entityWithField
    );
  }

  // ==========================================================
  // 7. WHAT IS ENTITY FIELD
  // ==========================================================

  const whatIsMatch =
    value.match(
      /^(?:what\s+is|what's|what\s+are)\s+(.+)$/i
    );

  if (
    whatIsMatch?.[1]
  ) {

    let entity =
      whatIsMatch[1].trim();

    entity =
      removeFieldFromEnd(
        entity,
        field
      );

    entity =
      cleanExtractedEntity(
        entity
      );

    if (
      entity &&
      isValidEntity(entity)
    ) {
      return normalizeEntity(
        entity
      );
    }
  }

  // ==========================================================
  // 8. REMOVE COMMON QUESTION PREFIXES
  // ==========================================================

  value =
    value
      .replace(
        /^(?:what\s+is|what's|what\s+are|who\s+is|who's|where\s+is|when\s+was|when\s+did|how\s+much|how\s+many)\s+/i,
        ""
      )
      .trim();

  // ==========================================================
  // 9. REMOVE FIELD
  // ==========================================================

  value =
    removeFieldFromEnd(
      value,
      field
    );

  value =
    removeFieldFromBeginning(
      value,
      field
    );

  // ==========================================================
  // 10. REMOVE ARTICLES
  // ==========================================================

  value =
    value
      .replace(
        /^(?:the|a|an)\s+/i,
        ""
      )
      .trim();

  // ==========================================================
  // 11. REMOVE TRAILING POSSESSIVE
  // ==========================================================

  value =
    value
      .replace(
        /['’]s$/i,
        ""
      )
      .trim();

  // ==========================================================
  // 12. VALIDATE
  // ==========================================================

  if (!value) {
    return null;
  }

  const normalized =
    normalizeEntity(value);

  if (
    !isValidEntity(
      normalized
    )
  ) {
    return null;
  }

  return normalized;
}

// ============================================================
// SEARCH TERMS
// ============================================================

function buildSearchTerms(
  entity: string | null,
  field: RequestedField,
  question: string
): string[] {

  const terms: string[] = [];

  if (
    entity
  ) {
    terms.push(
      entity
    );
  }

  if (
    field !== "unknown"
  ) {

    terms.push(
      field
    );

    terms.push(
      field.replace(
        /_/g,
        " "
      )
    );

    const aliases =
      getFieldAliases(field);

    for (
      const alias of aliases
    ) {

      const normalizedAlias =
        normalizeText(alias);

      if (
        normalizedAlias &&
        !terms.includes(
          normalizedAlias
        )
      ) {
        terms.push(
          normalizedAlias
        );
      }
    }
  }

  const normalized =
    normalizeText(question);

  if (
    normalized &&
    !terms.includes(
      normalized
    )
  ) {
    terms.push(
      normalized
    );
  }

  return [
    ...new Set(
      terms.filter(Boolean)
    ),
  ];
}

// ============================================================
// MAIN CLASSIFIER
// ============================================================

export function classifyQuestion(
  question: string
): LanguageUnderstanding {

  const text =
    normalizeText(question);

  // ==========================================================
  // EMPTY QUESTION PROTECTION
  // ==========================================================

  if (!text) {
    return {
      entity: null,
      intent: "unknown",
      requested_field: "unknown",
      search_terms: [],
      question_type: "unknown",
      date_filter: null,
      confidence: 0,
      method: "deterministic",
    };
  }

  // ==========================================================
  // FIELD
  // ==========================================================

  const field =
    detectField(
      text
    );

  // ==========================================================
  // INTENT
  // ==========================================================

  const intent =
    detectIntent(
      text,
      field
    );

  // ==========================================================
  // DATE FILTER
  // ==========================================================

  const dateFilter =
    detectDateFilter(
      text
    );

  console.log(
    "========== DATE DEBUG =========="
  );

  console.log({
    text,
    dateFilter,
  });

  // ==========================================================
  // FINAL INTENT
  // ==========================================================

  const finalIntent =
    dateFilter &&
    intent === "unknown"
      ? "date_filter"
      : intent;

  // ==========================================================
  // ENTITY
  //
  // IMPORTANT:
  // Use finalIntent here so date-only questions receive
  // intent === "date_filter" inside extractEntity().
  //
  // Existing domain intents remain unchanged because when
  // there is no date filter:
  //
  // finalIntent === intent
  // ==========================================================

  const entity =
    extractEntity(
      question,
      field,
      finalIntent
    );

  // ==========================================================
  // LOOKUP VERB
  // ==========================================================

  const hasLookupVerb =
    containsAny(
      text,
      LOOKUP_VERBS
    );

  // ==========================================================
  // QUESTION TYPE
  // ==========================================================

  const questionType =
    detectQuestionType(
      text,
      finalIntent,
      field
    );

  // ==========================================================
  // EXACT LOOKUP
  // ==========================================================

  const naturalAccountNameQuestion =
    field === "account_name" &&
    (
      /\bwhat\s+name\s+is\s+on\b.*\baccount\b/i.test(text) ||
      /\bname\s+on\b.*\baccount\b/i.test(text) ||
      /\bwhose\s+name\b.*\baccount\b/i.test(text) ||
      /\bwho\s+owns\b.*\baccount\b/i.test(text) ||
      /\bwho\s+is\s+named\s+on\b.*\baccount\b/i.test(text)
    );

  const transactionExact =
    finalIntent === "transaction_lookup" &&
    entity !== null;

  const documentExact =
    finalIntent === "document_lookup" &&
    entity !== null;

  const exact =
    entity !== null &&
    (
      field !== "unknown" ||
      transactionExact ||
      documentExact
    ) &&
    (
      hasLookupVerb ||
      /\bwhat\s+is\b/i.test(text) ||
      /\bwhat's\b/i.test(text) ||
      /\bof\b/i.test(text) ||
      /\bfor\b/i.test(text) ||
      naturalAccountNameQuestion ||
      transactionExact ||
      documentExact
    );

  // ==========================================================
  // SEARCH TERMS
  // ==========================================================

  const searchTerms =
    buildSearchTerms(
      entity,
      field,
      question
    );

  // ==========================================================
  // FINAL QUESTION TYPE
  // ==========================================================

  const finalQuestionType =
    exact
      ? "exact_lookup"
      : (
          finalIntent === "date_filter"
            ? "exact_lookup"
            : questionType
        );

  // ==========================================================
  // CONFIDENCE
  // ==========================================================

  let confidence =
    0.4;

  if (
    exact &&
    finalIntent !== "unknown" &&
    entity
  ) {

    confidence =
      0.99;

  } else if (
    dateFilter &&
    finalIntent === "date_filter"
  ) {

    confidence =
      0.99;

  } else if (
    finalIntent !== "unknown" &&
    field !== "unknown" &&
    entity
  ) {

    confidence =
      0.97;

  } else if (
    finalIntent !== "unknown" &&
    field !== "unknown"
  ) {

    confidence =
      0.95;

  } else if (
    finalIntent !== "unknown" &&
    entity
  ) {

    confidence =
      0.90;

  } else if (
    finalIntent !== "unknown"
  ) {

    confidence =
      0.85;

  } else if (
    entity
  ) {

    confidence =
      0.70;
  }

  // ==========================================================
  // FINAL DEBUG
  // ==========================================================

  console.log(
    "========== CLASSIFIER DEBUG =========="
  );

  console.log({
    question: text,
    entity,
    intent,
    finalIntent,
    field,
    questionType,
    finalQuestionType,
    dateFilter,
    confidence,
  });

  // ==========================================================
  // RETURN
  // ==========================================================

  return {
    entity,
    requested_field: field,
    search_terms: searchTerms,
    question_type: finalQuestionType,
    date_filter: dateFilter,
    intent: finalIntent,
    confidence,
    method: "deterministic",
  };
}