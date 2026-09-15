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

export interface LanguageUnderstanding {
  entity: string | null;
  intent: Intent;
  requested_field: RequestedField;
  search_terms: string[];
  question_type: QuestionType;
  confidence: number;
  method: "deterministic" | "llm";
}

// ============================================================
// HELPERS
// ============================================================

function escapeRegex(value: string): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
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
  /*
   * Must be checked BEFORE "balance".
   *
   * Examples:
   * uncleared balance
   * uncleared amount
   * uncleared funds
   * uncleared
   */
  if (
    /\buncleared\s+(?:balance|amount|funds)\b/i.test(text) ||
    /\buncleared\b/i.test(text)
  ) {
    return "uncleared_balance";
  }

  // ==========================================================
  // 2. OPEN DATE
  // ==========================================================
  /*
   * Examples:
   * open date
   * opening date
   * date opened
   * when opened
   * account opened
   * when was the account opened
   * when did Seth open the account
   */
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
  /*
   * This is deliberately checked AFTER
   * uncleared balance.
   */
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
  /*
   * Examples:
   *
   * contact
   * contact number
   * phone
   * phone number
   * telephone
   * telephone number
   * mobile
   * mobile number
   */
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
  /*
   * Natural account-name questions.
   *
   * Examples:
   *
   * What name is on Seth Olai's account?
   * What is the name on Seth Olai's account?
   * Show me the name on Seth Olai's account
   * Tell me the name on Seth Olai account
   * Give me the name on Seth Olai's account
   * Whose name is on Seth Olai's account?
   * Who owns the account for Seth Olai?
   * Who is named on Seth Olai's account?
   * Account holder name for Seth Olai
   */
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

  /*
   * Check longer phrases first.
   */
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

  /*
   * Account fields have priority.
   */
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

  if (field === "policy") {
    return "policy_lookup";
  }

  if (field === "procedure") {
    return "procedure_lookup";
  }

  if (field === "decision") {
    return "decision_lookup";
  }

  /*
   * General organizational knowledge.
   *
   * This must come before generic intent vocabularies
   * so broad organizational questions do not fall into
   * employee/project/document/etc. lookup accidentally.
   */

  /*
 * Explicit project entity questions.
 *
 * Examples:
 * - What information do we have on Leave Project?
 * - What information do we have about Leave Project?
 * - What information do we have for Leave Project?
 *
 * A named "... Project" phrase should remain a project lookup,
 * even when the question uses broad "information do we have"
 * wording.
 */
if (
  /\b(?:on|about|for)\s+.+\s+project\b/i.test(text)
) {
  return "project_lookup";
} 
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

  /*
   * Broad organizational list/overview questions.
   */
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

  /*
   * Financial questions have priority over
   * generic document terminology.
   */
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

  /*
   * Other known intent vocabularies.
   */
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
  // ============================================================
  // EXACT DOMAIN LOOKUPS
  // ============================================================

  if (
  intent === "transaction_lookup" ||
  intent === "document_lookup" ||
  intent === "policy_lookup" ||
  intent === "procedure_lookup" ||
  intent === "decision_lookup" ||
  intent === "project_lookup"
) {
  return "exact_lookup";
}

  // ============================================================
  // FIELD-BASED EXACT LOOKUP
  // ============================================================

  if (
    field !== "unknown" &&
    intent !== "unknown"
  ) {
    return "exact_lookup";
  }

  // ============================================================
  // LIST
  // ============================================================

  if (
    /\b(list|all|which|what are|show all|give me all)\b/i.test(text)
  ) {
    return "list";
  }

  // ============================================================
  // COMPARISON
  // ============================================================

  if (
    /\b(compare|comparison|difference|versus|vs|against)\b/i.test(text)
  ) {
    return "comparison";
  }

  // ============================================================
  // EXPLANATION
  // ============================================================

  if (
    /\b(why|explain|explanation|meaning|how does|how did|reason)\b/i.test(text)
  ) {
    return "explanation";
  }

  // ============================================================
  // SUMMARY
  // ============================================================

  if (
    /\b(summarize|summarise|summary|overview|brief|briefing)\b/i.test(text)
  ) {
    return "summary";
  }

  // ============================================================
  // GENERAL QUESTION
  // ============================================================

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

  /*
   * Compound lookup phrases first.
   */
  const compoundVerbPattern =
    /^(show\s+me|give\s+me|tell\s+me|provide\s+me|find\s+me|get\s+me)\s+/i;

  value =
    value.replace(
      compoundVerbPattern,
      ""
    );

  /*
   * Single lookup verbs.
   */
  const verbPattern =
    /^(find|fetch|get|show|give|retrieve|lookup|look\s+up|provide|tell|check|search|locate|identify|display|return|bring|pull|obtain|access|view|see|know)\b\s*/i;

  value =
    value.replace(
      verbPattern,
      ""
    );

  /*
   * Remove polite prefixes.
   */
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

  /*
   * Remove trailing punctuation.
   */
  result =
    result
      .replace(
        /[?!.;,]+$/g,
        ""
      )
      .trim();

  /*
   * Remove trailing possessive.
   */
  result =
    result
      .replace(
        /['’]s$/i,
        ""
      )
      .trim();

  /*
   * Remove common articles.
   */
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
// ENTITY EXTRACTION
// ============================================================
function extractEntity(
  originalQuestion: string,
  field: RequestedField,
  intent: Intent
): string | null {

  let value = originalQuestion
    .trim()
    .replace(/\?+$/, "")
    .trim();

    console.log("POLICY ENTITY DEBUG:", {
  originalQuestion,
  value,
  intent,
  field
});

// ==========================================================
// GENERAL ORGANIZATIONAL QUESTIONS WITHOUT AN ENTITY
// ==========================================================

if (intent === "general_knowledge") {

  // ----------------------------------------------------------
  // Exact known general-knowledge patterns
  // ----------------------------------------------------------

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
    genericGeneralQuestionPatterns.some((pattern) =>
      pattern.test(value)
    )
  ) {
    return null;
  }


  // ----------------------------------------------------------
  // Structural protection for broad organization questions
  //
  // Prevent generic entity extraction from treating phrases
  // such as:
  //
  // "what we know about the company"
  // "overview of the organization"
  // "summary of what we know about the organization"
  // "overview of the knowledge in OrgBrain"
  //
  // as entities.
  // ----------------------------------------------------------

  const broadGeneralStructurePatterns = [

    /^show\s+me\s+what\s+we\s+know\s+about\s+(?:the\s+)?(?:company|organization)$/i,

    /^give\s+me\s+(?:an?\s+)?overview\s+of\s+(?:the\s+)?(?:company|organization)$/i,

    /^give\s+me\s+(?:a\s+)?summary\s+of\s+what\s+we\s+know\s+about\s+(?:the\s+)?(?:company|organization)$/i,

    /^give\s+me\s+(?:an?\s+)?overview\s+of\s+the\s+knowledge\s+in\s+orgbrain$/i,

  ];

  if (
    broadGeneralStructurePatterns.some((pattern) =>
      pattern.test(value)
    )
  ) {
    return null;
  }
}
  // ============================================================
// POLICY ENTITY EXTRACTION
// ============================================================

if (intent === "policy_lookup") {

  // ----------------------------------------------------------
  // 1. TELL ME ABOUT ENTITY POLICY
  // ----------------------------------------------------------

  let match = value.match(
    /^tell\s+me\s+about\s+(?:the\s+)?(.+?)\s+policy$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 2. POLICY RECORD FOR ENTITY POLICY
  // ----------------------------------------------------------

  match = value.match(
    /^(?:find|show\s+me|show)\s+(?:the\s+)?policy\s+record\s+for\s+(.+?)\s+policy$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 3. POLICY INFORMATION FOR ENTITY POLICY
  // ----------------------------------------------------------

  match = value.match(
    /^give\s+me\s+(?:the\s+)?policy\s+information\s+for\s+(.+?)\s+policy$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 4. POLICY FOR ENTITY POLICY
  // ----------------------------------------------------------

  match = value.match(
    /^(?:find|show\s+me|show)\s+(?:the\s+)?policy\s+for\s+(.+?)\s+policy$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
// 5. TELL ME ENTITY POLICY DETAILS
// Examples:
// Tell me the Leave Policy details
// Tell me the Leave Policy information
// Tell me the Leave Policy record
// ----------------------------------------------------------

match = value.match(
  /^tell\s+me\s+(?:the\s+)?(.+?)\s+policy\s+(?:details?|records?|information)$/i
);

if (match?.[1]) {
  const entity = cleanExtractedEntity(match[1]);

  if (entity && isValidEntity(entity)) {
    return normalizeEntity(entity);
  }
}
  // ----------------------------------------------------------
  // 5. ENTITY + POLICY
  // ----------------------------------------------------------

  match = value.match(
    /^(?:find|get|show\s+me|show|retrieve|lookup|look\s+up|fetch|provide|give\s+me|check|what\s+is|what\s+are)\s+(?:the\s+)?(?:company's\s+)?(.+?)\s+policy(?:\s+(?:details?|records?|information))?$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 6. I NEED / WANT ENTITY POLICY
  // ----------------------------------------------------------

  match = value.match(
    /^(?:i\s+need|i\s+want|i\s+would\s+like)\s+(?:the\s+)?(.+?)\s+policy(?:\s+(?:details?|records?|information))?$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 7. WHAT POLICY INFORMATION DO WE HAVE
  // ----------------------------------------------------------

  match = value.match(
    /^what\s+policy\s+information\s+do\s+we\s+have\s+for\s+(.+?)\s+policy$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 8. WHAT INFORMATION DO WE HAVE ON POLICY
  // ----------------------------------------------------------

  match = value.match(
    /^what\s+information\s+do\s+we\s+have\s+(?:on|for)\s+(.+?)\s+policy$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }
}
// ============================================================
// PROCEDURE / PROCESS ENTITY EXTRACTION
// ============================================================

if (intent === "procedure_lookup") {

  // ----------------------------------------------------------
  // 1. TELL ME ABOUT ENTITY PROCEDURE
  // ----------------------------------------------------------

  let match = value.match(
    /^tell\s+me\s+about\s+(?:the\s+)?(.+?)\s+procedure$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 2. PROCEDURE RECORD FOR ENTITY PROCEDURE
  // ----------------------------------------------------------

  match = value.match(
    /^(?:find|show\s+me|show)\s+(?:the\s+)?procedure\s+record\s+for\s+(.+?)\s+procedure$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 3. PROCEDURE INFORMATION FOR ENTITY PROCEDURE
  // ----------------------------------------------------------

  match = value.match(
    /^give\s+me\s+(?:the\s+)?procedure\s+information\s+for\s+(.+?)\s+procedure$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 4. PROCEDURE FOR ENTITY PROCEDURE
  // ----------------------------------------------------------

  match = value.match(
    /^(?:find|show\s+me|show)\s+(?:the\s+)?procedure\s+for\s+(.+?)\s+procedure$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 5. ENTITY + PROCEDURE
  // ----------------------------------------------------------

  match = value.match(
    /^(?:find|get|show\s+me|show|retrieve|lookup|look\s+up|fetch|provide|give\s+me|check|what\s+is|what\s+are)\s+(?:the\s+)?(?:company's\s+)?(.+?)\s+procedure(?:\s+(?:details?|records?|information))?$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 6. TELL ME ENTITY PROCEDURE DETAILS
  // ----------------------------------------------------------

  match = value.match(
    /^tell\s+me\s+(?:the\s+)?(.+?)\s+procedure\s+(?:details?|records?|information)$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 7. I NEED / WANT ENTITY PROCEDURE
  // ----------------------------------------------------------

  match = value.match(
    /^(?:i\s+need|i\s+want|i\s+would\s+like)\s+(?:the\s+)?(.+?)\s+procedure(?:\s+(?:details?|records?|information))?$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 8. WHAT PROCEDURE INFORMATION DO WE HAVE
  // ----------------------------------------------------------

  match = value.match(
    /^what\s+procedure\s+information\s+do\s+we\s+have\s+for\s+(.+?)\s+procedure$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 9. WHAT INFORMATION DO WE HAVE ON PROCEDURE
  // ----------------------------------------------------------

  match = value.match(
    /^what\s+information\s+do\s+we\s+have\s+(?:on|for)\s+(.+?)\s+procedure$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }
}

// ============================================================
// DECISION / APPROVAL ENTITY EXTRACTION
// ============================================================

if (intent === "decision_lookup") {

  // ----------------------------------------------------------
  // 1. TELL ME ABOUT ENTITY DECISION
  // ----------------------------------------------------------

  let match = value.match(
    /^tell\s+me\s+about\s+(?:the\s+)?(.+?)\s+decision$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 2. DECISION RECORD FOR ENTITY DECISION
  // ----------------------------------------------------------

  match = value.match(
    /^(?:find|show\s+me|show)\s+(?:the\s+)?decision\s+record\s+for\s+(.+?)\s+decision$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 3. DECISION INFORMATION FOR ENTITY DECISION
  // ----------------------------------------------------------

  match = value.match(
    /^give\s+me\s+(?:the\s+)?decision\s+information\s+for\s+(.+?)\s+decision$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 4. DECISION FOR ENTITY DECISION
  // ----------------------------------------------------------

  match = value.match(
    /^(?:find|show\s+me|show)\s+(?:the\s+)?decision\s+for\s+(.+?)\s+decision$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 5. ENTITY + DECISION
  // ----------------------------------------------------------

  match = value.match(
    /^(?:find|get|show\s+me|show|retrieve|lookup|look\s+up|fetch|provide|give\s+me|check|what\s+is|what\s+are)\s+(?:the\s+)?(?:company's\s+)?(.+?)\s+decision(?:\s+(?:details?|records?|information))?$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 6. TELL ME ENTITY DECISION DETAILS
  // ----------------------------------------------------------

  match = value.match(
    /^tell\s+me\s+(?:the\s+)?(.+?)\s+decision\s+(?:details?|records?|information)$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 7. I NEED / WANT ENTITY DECISION
  // ----------------------------------------------------------

  match = value.match(
    /^(?:i\s+need|i\s+want|i\s+would\s+like)\s+(?:the\s+)?(.+?)\s+decision(?:\s+(?:details?|records?|information))?$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 8. WHAT DECISION INFORMATION DO WE HAVE
  // ----------------------------------------------------------

  match = value.match(
    /^what\s+decision\s+information\s+do\s+we\s+have\s+for\s+(.+?)\s+decision$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 9. WHAT INFORMATION DO WE HAVE ON DECISION
  // ----------------------------------------------------------

  match = value.match(
    /^what\s+information\s+do\s+we\s+have\s+(?:on|for)\s+(.+?)\s+decision$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }
}


// ============================================================
// PROJECT / INITIATIVE ENTITY EXTRACTION
// ============================================================

if (intent === "project_lookup") {

  console.log("========== PROJECT ENTITY BLOCK ==========");
  console.log({
    originalQuestion,
    value,
    intent,
    field,
  });

  // ----------------------------------------------------------
  // 1. TELL ME ABOUT ENTITY PROJECT
  // ----------------------------------------------------------

  let match = value.match(
    /^tell\s+me\s+about\s+(?:the\s+)?(.+?)\s+project$/i
  );
  console.log("PROJECT PATTERN 1:", match);

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    console.log("PROJECT EXTRACTED ENTITY:", entity);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 2. PROJECT RECORD FOR ENTITY PROJECT
  // ----------------------------------------------------------

  match = value.match(
    /^(?:find|show\s+me|show)\s+(?:the\s+)?project\s+record\s+for\s+(.+?)\s+project$/i
  );

  // ----------------------------------------------------------
// 1B. TELL ME ENTITY PROJECT
// ----------------------------------------------------------

match = value.match(
  /^tell\s+me\s+(?:the\s+)?(.+?)\s+project$/i
);

console.log("PROJECT PATTERN 1B:", match);

if (match?.[1]) {
  const entity = cleanExtractedEntity(match[1]);

  console.log("PROJECT EXTRACTED ENTITY 1B:", entity);

  if (entity && isValidEntity(entity)) {
    return normalizeEntity(entity);
  }
}
  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
// ----------------------------------------------------------
// 2. PROJECT RECORD FOR ENTITY
// ----------------------------------------------------------

match = value.match(
  /^(?:find|show\s+me|show)\s+(?:the\s+)?project\s+record\s+for\s+(.+?)$/i
);

console.log("PROJECT RECORD PATTERN:", match);

if (match?.[1]) {
  const entity = cleanExtractedEntity(
    match[1].replace(/\s+project$/i, "")
  );

  console.log("PROJECT RECORD EXTRACTED ENTITY:", entity);

  if (entity && isValidEntity(entity)) {
    return normalizeEntity(entity);
  }
}

  // ----------------------------------------------------------
  // 3. PROJECT INFORMATION FOR ENTITY PROJECT
  // ----------------------------------------------------------

  match = value.match(
    /^give\s+me\s+(?:the\s+)?project\s+information\s+for\s+(.+?)\s+project$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 4. PROJECT FOR ENTITY PROJECT
  // ----------------------------------------------------------

  match = value.match(
    /^(?:find|show\s+me|show)\s+(?:the\s+)?project\s+for\s+(.+?)\s+project$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 5. ENTITY + PROJECT
  // ----------------------------------------------------------

  match = value.match(
    /^(?:find|get|show\s+me|show|retrieve|lookup|look\s+up|fetch|provide|give\s+me|check|what\s+is|what\s+are)\s+(?:the\s+)?(?:company's\s+)?(.+?)\s+project(?:\s+(?:details?|records?|information))?$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 6. TELL ME ENTITY PROJECT DETAILS
  // ----------------------------------------------------------

  match = value.match(
    /^tell\s+me\s+(?:the\s+)?(.+?)\s+project\s+(?:details?|records?|information)$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 7. I NEED / WANT ENTITY PROJECT
  // ----------------------------------------------------------

  match = value.match(
    /^(?:i\s+need|i\s+want|i\s+would\s+like)\s+(?:the\s+)?(.+?)\s+project(?:\s+(?:details?|records?|information))?$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 8. WHAT PROJECT INFORMATION DO WE HAVE
  // ----------------------------------------------------------

  match = value.match(
    /^what\s+project\s+information\s+do\s+we\s+have\s+for\s+(.+?)\s+project$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // 9. WHAT INFORMATION DO WE HAVE ON PROJECT
  // ----------------------------------------------------------

  match = value.match(
    /^what\s+information\s+do\s+we\s+have\s+(?:on|for)\s+(.+?)\s+project$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }
}
// ============================================================
// TRANSACTION 
// ============================================================


if (intent === "transaction_lookup") {

//   // ============================================================
// // HIGH-PRIORITY POLICY PATTERNS
// // ============================================================

// // 1. Tell me about the Leave Policy
// // 2. Tell me about Leave Policy
// const aboutPolicyExact = value.match(
//   /^tell\s+me\s+about\s+(?:the\s+)?(.+?)\s+policy$/i
// );

// if (aboutPolicyExact?.[1]) {
//   const entity = cleanExtractedEntity(aboutPolicyExact[1]);

//   if (entity && isValidEntity(entity)) {
//     return normalizeEntity(entity);
//   }
// }


// // 3. Find the policy record for Leave Policy
// // 4. Show me the policy record for Leave Policy
// const policyRecordExact = value.match(
//   /^(?:find|show\s+me|show)\s+(?:the\s+)?policy\s+record\s+for\s+(.+?)\s+policy$/i
// );

// if (policyRecordExact?.[1]) {
//   const entity = cleanExtractedEntity(policyRecordExact[1]);

//   if (entity && isValidEntity(entity)) {
//     return normalizeEntity(entity);
//   }
// }


// // 5. Give me the policy information for Leave Policy
// const policyInformationExact = value.match(
//   /^give\s+me\s+(?:the\s+)?policy\s+information\s+for\s+(.+?)\s+policy$/i
// );

// if (policyInformationExact?.[1]) {
//   const entity = cleanExtractedEntity(policyInformationExact[1]);

//   if (entity && isValidEntity(entity)) {
//     return normalizeEntity(entity);
//   }
// }


// // 6. Find the policy for Leave Policy
// // 7. Show me the policy for Leave Policy
// const policyForExact = value.match(
//   /^(?:find|show\s+me|show)\s+(?:the\s+)?policy\s+for\s+(.+?)\s+policy$/i
// );

// if (policyForExact?.[1]) {
//   const entity = cleanExtractedEntity(policyForExact[1]);

//   if (entity && isValidEntity(entity)) {
//     return normalizeEntity(entity);
//   }
// }


  // FIX #20
  if (
    /^tell\s+me\s+about\s+(.+?)['’]s\s+transactions?\??$/i.test(value)
  ) {
    const match = value.match(
      /^tell\s+me\s+about\s+(.+?)['’]s\s+transactions?\??$/i
    );

    if (match?.[1]) {
      return normalizeEntity(match[1].trim());
    }
  }

  // FIX #23
  if (
    /^what\s+information\s+do\s+we\s+have\s+on\s+(.+?)['’]s\s+transactions?\??$/i.test(
      value
    )
  ) {
    const match = value.match(
      /^what\s+information\s+do\s+we\s+have\s+on\s+(.+?)['’]s\s+transactions?\??$/i
    );

    if (match?.[1]) {
      return normalizeEntity(match[1].trim());
    }
  }

  // FIX #24
  if (
    /^(?:give\s+me|show\s+me|tell\s+me|get|find|retrieve|i\s+need|i\s+want|i\s+would\s+like)\s+(.+?)['’]s\s+transaction\s+(?:record|details?)\??$/i.test(
      value
    )
  ) {
    const match = value.match(
      /^(?:give\s+me|show\s+me|tell\s+me|get|find|retrieve|i\s+need|i\s+want|i\s+would\s+like)\s+(.+?)['’]s\s+transaction\s+(?:record|details?)\??$/i
    );

    if (match?.[1]) {
      return normalizeEntity(match[1].trim());
    }
  }

  // --------------------------------------------------
  // A. ENTITY + TRANSACTION/PAYMENT
  // --------------------------------------------------

  const entityFirstMatch = value.match(
    /^(?:find|show\s+me|show|find\s+me|get|retrieve|lookup|look\s+up|fetch|provide|give\s+me|tell\s+me|check|what\s+is|what\s+are)\s+(?:the\s+)?(.+?)\s+(?:transaction|transactions|payment|payments)(?:\s+(?:detail|details|record|records|information))?\??$/i
  );

  if (entityFirstMatch?.[1]) {
    const entity = entityFirstMatch[1].trim();

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // --------------------------------------------------
  // B. TRANSACTION/PAYMENT + FOR/ON + ENTITY
  // --------------------------------------------------

  const entityLastMatch = value.match(
    /^(?:find|show\s+me|show|find\s+me|get|retrieve|lookup|look\s+up|fetch|provide|give\s+me|tell\s+me|check)\s+(?:the\s+)?(?:transaction|transactions|payment|payments)\s+(?:detail|details|record|records|information)\s+(?:for|of|on)\s+(.+?)\??$/i
  );

  if (entityLastMatch?.[1]) {
    const entity = entityLastMatch[1].trim();

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // --------------------------------------------------
  // C. TRANSACTION INFORMATION + FOR/ON + ENTITY
  // --------------------------------------------------

  const transactionInfoMatch = value.match(
    /^what\s+transaction\s+(?:information|details|records?)\s+(?:do\s+we\s+have|do\s+you\s+have)\s+(?:for|on)\s+(.+?)\??$/i
  );

  if (transactionInfoMatch?.[1]) {
    const entity = transactionInfoMatch[1].trim();

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // --------------------------------------------------
  // D. POSSESSIVE TRANSACTION/PAYMENT
  // --------------------------------------------------

  const possessiveMatch = value.match(
    /^(?:tell\s+me\s+about|what\s+information\s+do\s+we\s+have\s+(?:on|for)|give\s+me|show\s+me|tell\s+me|get|find|retrieve|i\s+need|i\s+want|i\s+would\s+like)\s+(.+?)['’]s\s+(?:transaction|transactions|payment|payments)(?:\s+(?:detail|details|record|records|information))?\??$/i
  );

  if (possessiveMatch?.[1]) {
    const entity = possessiveMatch[1].trim();

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // --------------------------------------------------
  // E. DIRECT "ABOUT" TRANSACTIONS
  // --------------------------------------------------

  const aboutMatch = value.match(
    /^tell\s+me\s+about\s+(.+?)['’]s\s+(?:transaction|transactions|payment|payments)\??$/i
  );

  if (aboutMatch?.[1]) {
    const entity = aboutMatch[1].trim();

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

} // <-- IMPORTANT: closes transaction_lookup

// ============================================================
// 1G. DOCUMENT / FILE ENTITY EXTRACTION
// ============================================================

if (intent === "document_lookup") {

  // ----------------------------------------------------------
// FIX: TELL ME ABOUT THE DOCUMENT/FILE
// ----------------------------------------------------------

const tellAboutDocumentMatch = value.match(
  /^tell\s+me\s+about\s+(?:the\s+)?(.+?)\s+(?:document|documents|file|files)(?:\s+(?:detail|details|record|records|information))?\??$/i
);

if (tellAboutDocumentMatch?.[1]) {
  const entity = cleanExtractedEntity(
    cleanDomainEntity(
      tellAboutDocumentMatch[1]
    )
  );

  if (entity && isValidEntity(entity)) {
    return normalizeEntity(entity);
  }
}

  // ----------------------------------------------------------
  // A. ENTITY + DOCUMENT/FILE
  //
  // Find ADEVAG LETTER HEAD document
  // What is ADEVAG LETTER HEAD document?
  // Get ADEVAG LETTER HEAD document
  // Show me ADEVAG LETTER HEAD document
  // ----------------------------------------------------------

  const entityFirstMatch = value.match(
    /^(?:find|show\s+me|show|find\s+me|get|retrieve|lookup|look\s+up|fetch|provide|give\s+me|tell\s+me|check|what\s+is|what\s+are)\s+(?:the\s+)?(.+?)\s+(?:document|documents|file|files)(?:\s+(?:detail|details|record|records|information))?\??$/i
  );

  if (entityFirstMatch?.[1]) {
    const entity = cleanExtractedEntity(
      cleanDomainEntity(entityFirstMatch[1])
    );

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // B. DOCUMENT/FILE + DETAILS + ENTITY
  //
  // Find the document record for ADEVAG LETTER HEAD
  // Show me the file record for ADEVAG LETTER HEAD
  // ----------------------------------------------------------

  const entityLastMatch = value.match(
    /^(?:find|show\s+me|show|find\s+me|get|retrieve|lookup|look\s+up|fetch|provide|give\s+me|tell\s+me|check)\s+(?:the\s+)?(?:document|documents|file|files)\s+(?:detail|details|record|records|information)\s+(?:for|of|on)\s+(.+?)\??$/i
  );

  if (entityLastMatch?.[1]) {
    const entity = cleanExtractedEntity(
      cleanDomainEntity(entityLastMatch[1])
    );

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // C. WHAT DOCUMENT INFORMATION DO WE HAVE FOR ENTITY
  //
  // What document information do we have for ADEVAG LETTER HEAD?
  // ----------------------------------------------------------

  const documentInfoMatch = value.match(
    /^what\s+document\s+(?:information|details|records?)\s+do\s+we\s+have\s+(?:for|on)\s+(.+?)\??$/i
  );

  if (documentInfoMatch?.[1]) {
    const entity = cleanExtractedEntity(
      cleanDomainEntity(documentInfoMatch[1])
    );

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // D. WHAT INFORMATION DO WE HAVE ON ENTITY
  //
  // What information do we have on ADEVAG LETTER HEAD?
  // ----------------------------------------------------------

  const informationMatch = value.match(
    /^what\s+information\s+do\s+we\s+have\s+(?:on|for)\s+(.+?)\??$/i
  );

  if (informationMatch?.[1]) {
    const entity = cleanExtractedEntity(
      cleanDomainEntity(informationMatch[1])
    );

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // E. TELL ME ABOUT ENTITY + DOCUMENT/FILE
  //
  // Tell me about the ADEVAG LETTER HEAD file
  // Tell me about ADEVAG LETTER HEAD document
  // ----------------------------------------------------------

  const aboutDocumentMatch = value.match(
    /^tell\s+me\s+about\s+(?:the\s+)?(.+?)\s+(?:document|documents|file|files)(?:\s+(?:detail|details|record|records|information))?\??$/i
  );

  if (aboutDocumentMatch?.[1]) {
    const entity = cleanExtractedEntity(
      cleanDomainEntity(aboutDocumentMatch[1])
    );

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // F. SIMPLE "TELL ME ABOUT ENTITY"
  //
  // Tell me about ADEVAG LETTER HEAD
  // ----------------------------------------------------------

  const simpleAboutMatch = value.match(
    /^tell\s+me\s+about\s+(?:the\s+)?(.+?)\??$/i
  );

  if (simpleAboutMatch?.[1]) {
    const entity = cleanExtractedEntity(
      cleanDomainEntity(simpleAboutMatch[1])
    );

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // ----------------------------------------------------------
  // G. I NEED / WANT ENTITY DOCUMENT DETAILS
  //
  // I need ADEVAG LETTER HEAD document details
  // I want ADEVAG LETTER HEAD file details
  // ----------------------------------------------------------

  const needDocumentMatch = value.match(
    /^(?:i\s+need|i\s+want|i\s+would\s+like)\s+(?:the\s+)?(.+?)\s+(?:document|documents|file|files)(?:\s+(?:detail|details|record|records|information))?\??$/i
  );

  if (needDocumentMatch?.[1]) {
    const entity = cleanExtractedEntity(
      cleanDomainEntity(needDocumentMatch[1])
    );

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }
}

// ==========================================================
// GENERAL ORGANIZATIONAL ENTITY EXTRACTION
// ==========================================================

if (intent === "general_knowledge") {

  // --------------------------------------------------------
  // WHAT INFORMATION DO WE HAVE ON/FOR ENTITY
  // Examples:
  // What information do we have on Leave Project?
  // What information do we have about Leave Project?
  // What information do we have for Leave Project?
  // --------------------------------------------------------

  let match = value.match(
    /^what\s+information\s+do\s+we\s+have\s+(?:on|about|for)\s+(.+?)$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }

  // --------------------------------------------------------
  // WHAT DO WE KNOW ABOUT/ON ENTITY
  // Examples:
  // What do we know about Leave Project?
  // What do we know about the organization?
  // --------------------------------------------------------

  match = value.match(
    /^what\s+do\s+we\s+know\s+(?:about|on)\s+(.+?)$/i
  );

  if (match?.[1]) {
    const entity = cleanExtractedEntity(match[1]);

    if (entity && isValidEntity(entity)) {
      return normalizeEntity(entity);
    }
  }
}

  // ==========================================================
  // 1. FIELD + OF/FOR + ENTITY
  //
  // What is the account number of Seth Olai?
  // What is the balance for Seth Olai?
  // Account number of Seth Olai
  // Customer details for Seth Olai
  // ==========================================================

  const fieldAliases = getFieldAliases(field);

  if (fieldAliases.length > 0) {
    const fieldPattern = fieldAliases
      .map(escapeRegex)
      .join("|");

    const fieldOfForRegex = new RegExp(
      `(?:^|\\s)(?:${fieldPattern})\\s+(?:of|for)\\s+(.+?)$`,
      "i"
    );

    const fieldOfForMatch =
      value.match(fieldOfForRegex);

    if (fieldOfForMatch?.[1]) {
      const entity = cleanExtractedEntity(
        fieldOfForMatch[1]
      );

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(entity);
      }
    }
  }

  // ==========================================================
  // 1B. NATURAL OPENING-DATE QUESTIONS
  // ==========================================================

  if (field === "open_date") {
    const openingDatePatterns = [
      /^(?:when\s+was)\s+(.+?)\s+(?:account\s+)?opened$/i,

      /^(?:when\s+did)\s+(.+?)\s+open\s+(?:the\s+)?account$/i,

      /^(?:when\s+was)\s+(.+?)['’]s\s+account\s+opened$/i,

      /^(?:when\s+did)\s+(.+?)\s+open\s+(?:his|her|their)\s+account$/i,
    ];

    for (
      const pattern of openingDatePatterns
    ) {
      const match = value.match(pattern);

      if (match?.[1]) {
        const entity =
          cleanExtractedEntity(match[1]);

        if (
          entity &&
          isValidEntity(entity)
        ) {
          return normalizeEntity(entity);
        }
      }
    }
  }

  // ==========================================================
  // 1C. NATURAL ACCOUNT-NAME QUESTIONS
  // ==========================================================

  if (field === "account_name") {
    value = value
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
      const match = value.match(pattern);

      if (match?.[1]) {
        const entity =
          cleanExtractedEntity(match[1]);

        if (
          entity &&
          isValidEntity(entity)
        ) {
          return normalizeEntity(entity);
        }
      }
    }
  }

  // ==========================================================
  // 1D. NATURAL CUSTOMER / CLIENT QUESTIONS
  //
  // Find the customer record for Seth Olai
  // Show me the customer record for Seth Olai
  // What customer information do we have for Seth Olai?
  // Tell me about Seth Olai as a customer
  // What information do we have on Seth Olai as a client?
  // ==========================================================

  // ==========================================================
// 1D. NATURAL CUSTOMER / CLIENT QUESTIONS
// ==========================================================

if (field === "customer_name") {
  const customerPatterns = [

  // ========================================================
  // 1. SHOW ME THE CUSTOMER/CLIENT RECORD FOR ENTITY
  //    MUST COME BEFORE GENERIC "SHOW" PATTERNS
  // ========================================================

  /^(?:show\s+me|find|get|retrieve|lookup|look\s+up|fetch|provide|give\s+me|tell\s+me|check)\s+(?:the\s+)?(?:customer|client)\s+(?:record|details|information)\s+(?:for|of)\s+(.+?)$/i,

  // ========================================================
  // 2. CUSTOMER/CLIENT RECORD FOR ENTITY
  // ========================================================

  /^(?:customer|client)\s+(?:record|details|information)\s+(?:for|of)\s+(.+?)$/i,

  // ========================================================
  // 3. SHOW ME / OTHER VERB + ENTITY + CUSTOMER/CLIENT
  // ========================================================

  /^(?:show\s+me|show|find|get|retrieve|lookup|look\s+up|fetch|provide|give\s+me|tell\s+me|check)\s+(?:the\s+)?(.+?)\s+(?:customer|client)\s+(?:details|information|record)$/i,

  // ========================================================
  // 4. WHAT IS/ARE + ENTITY + CUSTOMER/CLIENT
  // ========================================================

  /^(?:what\s+is|what\s+are)\s+(.+?)\s+(?:customer|client)\s+(?:details|information|record)\??$/i,

  // ========================================================
  // 5. CUSTOMER/CLIENT INFORMATION WE HAVE FOR ENTITY
  // ========================================================

  /^(?:what\s+)?(?:customer|client)\s+(?:information|details)\s+(?:do\s+we\s+have|do\s+you\s+have)\s+(?:for|on)\s+(.+?)$/i,

  // ========================================================
  // 6. WHAT INFORMATION DO WE HAVE ON ENTITY AS CUSTOMER
  // ========================================================

  /^(?:what\s+)?information\s+(?:do\s+we\s+have|do\s+you\s+have)\s+(?:on|for)\s+(.+?)\s+as\s+(?:a\s+)?(?:customer|client)\??$/i,

  // ========================================================
  // 7. TELL ME ABOUT ENTITY AS CUSTOMER
  // ========================================================

  /^(?:tell\s+me)\s+about\s+(.+?)\s+as\s+(?:a\s+)?(?:customer|client)\??$/i,

  // ========================================================
  // 8. POSSESSIVE CUSTOMER RECORD
  // ========================================================

  /^(?:give\s+me|show\s+me|tell\s+me|get|find|retrieve)\s+(.+?)['’]s\s+(?:customer|client)\s+(?:record|details|information)$/i,

  // ========================================================
  // 9. I NEED / WANT POSSESSIVE CUSTOMER RECORD
  // ========================================================

  /^(?:i\s+need|i\s+want|i\s+would\s+like)\s+(.+?)['’]s\s+(?:customer|client)\s+(?:record|details|information)$/i,
];

  for (const pattern of customerPatterns) {
    const match = value.match(pattern);

    if (match?.[1]) {
      const entity = cleanExtractedEntity(match[1]);

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(entity);
      }
    }
  }
}



// ==========================================================
// 1E. NATURAL EMPLOYEE / STAFF QUESTIONS
// ==========================================================

if (field === "employee_name") {
  const employeePatterns = [

    // EMPLOYEE/STAFF RECORD FOR ENTITY
    /^(?:find|show\s+me|show|find\s+me|get|retrieve|lookup|look\s+up|fetch|provide|give\s+me|tell\s+me|check)\s+(?:the\s+)?(?:employee|staff)\s+(?:record|details|information)\s+(?:for|of)\s+(.+?)$/i,

    // ENTITY + EMPLOYEE/STAFF + DETAILS
    /^(?:find|show\s+me|show|find\s+me|get|retrieve|lookup|look\s+up|fetch|provide|give\s+me|tell\s+me|check)\s+(?:the\s+)?(.+?)\s+(?:employee|staff)\s+(?:details|information|record)$/i,

    // WHAT IS/ARE ENTITY + EMPLOYEE/STAFF
    /^(?:what\s+is|what\s+are)\s+(.+?)\s+(?:employee|staff)\s+(?:details|information|record)\??$/i,

    // EMPLOYEE/STAFF INFORMATION FOR ENTITY
    /^(?:what\s+)?(?:employee|staff)\s+(?:information|details)\s+(?:do\s+we\s+have|do\s+you\s+have)\s+(?:for|on)\s+(.+?)$/i,

    // INFORMATION ON ENTITY AS EMPLOYEE/STAFF
    /^(?:what\s+)?information\s+(?:do\s+we\s+have|do\s+you\s+have)\s+(?:on|for)\s+(.+?)\s+as\s+(?:an\s+employee|a\s+staff\s+member|staff)\??$/i,

    // TELL ME ABOUT ENTITY AS EMPLOYEE
    /^(?:tell\s+me)\s+about\s+(.+?)\s+as\s+(?:an\s+employee|a\s+staff\s+member|staff)\??$/i,

    // POSSESSIVE EMPLOYEE/STAFF RECORD
    /^(?:give\s+me|show\s+me|tell\s+me|get|find|retrieve)\s+(.+?)['’]s\s+(?:employee|staff)\s+(?:record|details|information)$/i,

    // I NEED / WANT POSSESSIVE EMPLOYEE RECORD
    /^(?:i\s+need|i\s+want|i\s+would\s+like)\s+(.+?)['’]s\s+(?:employee|staff)\s+(?:record|details|information)$/i,
  ];

  for (const pattern of employeePatterns) {
    const match = value.match(pattern);

    if (match?.[1]) {
      const entity = cleanExtractedEntity(match[1]);

      if (
        entity &&
        isValidEntity(entity)
      ) {
        return normalizeEntity(entity);
      }
    }
  }
}

  // ==========================================================
  // 2. REMOVE POLITE PREFIXES
  // ==========================================================

  value = value
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
    value = value
      .replace(
        compoundLookupPrefix,
        ""
      )
      .trim();

    value = removeFieldFromEnd(
      value,
      field
    );

    value = cleanExtractedEntity(value);

    if (
      value &&
      isValidEntity(value)
    ) {
      return normalizeEntity(value);
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
    value = value
      .replace(
        lookupPrefix,
        ""
      )
      .trim();

    value = value
      .replace(
        /^please\s+/i,
        ""
      )
      .trim();

    value = removeFieldFromEnd(
      value,
      field
    );

    value = cleanExtractedEntity(value);

    if (
      value &&
      isValidEntity(value)
    ) {
      return normalizeEntity(value);
    }
  }

  // ==========================================================
  // 5. POSSESSIVE QUESTION
  // ==========================================================

  const possessiveRegex =
    /^(?:what\s+is|what's|what\s+are|who\s+is|who's|tell\s+me|give\s+me|show\s+me)\s+(.+?)['’]s\s+/i;

  const possessiveMatch =
    value.match(possessiveRegex);

  if (possessiveMatch?.[1]) {
    const entity =
      cleanExtractedEntity(
        possessiveMatch[1]
      );

    if (
      entity &&
      isValidEntity(entity)
    ) {
      return normalizeEntity(entity);
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

  if (whatIsMatch?.[1]) {
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
      return normalizeEntity(entity);
    }
  }

  // ==========================================================
  // 8. REMOVE COMMON QUESTION PREFIXES
  // ==========================================================

  value = value
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

  value = value
    .replace(
      /^(?:the|a|an)\s+/i,
      ""
    )
    .trim();

  // ==========================================================
  // 11. REMOVE TRAILING POSSESSIVE
  // ==========================================================

  value = value
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

  if (entity) {
    terms.push(entity);
  }

  if (
    field !== "unknown"
  ) {
    terms.push(field);

    /*
     * Human-readable field name.
     */
    terms.push(
      field.replace(
        /_/g,
        " "
      )
    );

    /*
     * Include known field aliases.
     */
    const aliases =
      getFieldAliases(field);

    for (
      const alias
      of aliases
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
      confidence: 0,
      method: "deterministic",
    };
  }

  // ==========================================================
  // FIELD
  // ==========================================================

  const field =
    detectField(text);

  // ==========================================================
  // INTENT
  // ==========================================================

  const intent =
    detectIntent(
      text,
      field
    );

  // ==========================================================
  // ENTITY
  // ==========================================================

  const entity =
  extractEntity(
    question,
    field,
    intent
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
      intent,
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
  intent === "transaction_lookup" &&
  entity !== null;

const documentExact =
  intent === "document_lookup" &&
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
      : questionType;

  // ==========================================================
  // CONFIDENCE
  // ==========================================================

  let confidence = 0.4;

  if (
    exact &&
    intent !== "unknown" &&
    entity
  ) {
    confidence = 0.99;
  } else if (
    intent !== "unknown" &&
    field !== "unknown" &&
    entity
  ) {
    confidence = 0.97;
  } else if (
    intent !== "unknown" &&
    field !== "unknown"
  ) {
    confidence = 0.95;
  } else if (
    intent !== "unknown" &&
    entity
  ) {
    confidence = 0.90;
  } else if (
    intent !== "unknown"
  ) {
    confidence = 0.85;
  } else if (
    entity
  ) {
    confidence = 0.70;
  }

  // ==========================================================
  // RETURN
  // ==========================================================
console.log("========== PROJECT DEBUG ==========");
console.log({
  question:
  entity,
  intent,
  field,
  questionType: finalQuestionType,
  confidence,
});
  return {
    entity,

    intent,

    requested_field:
      field,

    search_terms:
      searchTerms,

    question_type:
      finalQuestionType,

    confidence,

    method:
      "deterministic",
  };
}