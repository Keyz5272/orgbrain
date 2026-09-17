import type {
  LanguageUnderstanding,
  Intent,
  RequestedField,
} from "@/lib/knowledge/language/classifier";

export type RetrievalMode =
  | "structured"
  | "semantic"
  | "hybrid";

export interface QueryPlan {
  mode: RetrievalMode;

  searchTerms: string[];

  entity: string | null;

  intent: Intent;

  requestedField: RequestedField;

  limit: number;

  structured: {
    enabled: boolean;
    searchTerms: string[];
    recordType: string | null;
  };

  semantic: {
    enabled: boolean;
    queries: string[];
  };

  reason: string[];
}

export function createQueryPlan(
  understanding: LanguageUnderstanding
): QueryPlan {
  const {
    entity,
    intent,
    requested_field,
    search_terms,
    question_type,
  } = understanding;

  const reasons: string[] = [];

  const isStructuredIntent =
    intent === "account_lookup" ||
    intent === "customer_lookup" ||
    intent === "employee_lookup" ||
    intent === "transaction_lookup" ||
    intent === "financial_lookup";

  const isSemanticIntent =
    intent === "policy_lookup" ||
    intent === "procedure_lookup" ||
    intent === "document_lookup" ||
    intent === "decision_lookup" ||
    intent === "project_lookup" ||
    intent === "general_knowledge";

  const hasEntity = Boolean(entity);

  /*
   * Structured retrieval is preferred when the question
   * is asking for a specific record or field.
   */
  const isBroadStructuredQuery =
  isStructuredIntent &&
  !hasEntity &&
  (
    question_type === "list" ||
    question_type === "summary" ||
    question_type === "exact_lookup"||
    intent === "account_lookup" ||
    intent === "customer_lookup" ||
    intent === "employee_lookup" ||
    intent === "transaction_lookup"
  );

const structuredEnabled =
  isStructuredIntent &&
  (hasEntity || isBroadStructuredQuery);

  /*
   * Semantic retrieval is useful for organizational
   * knowledge, policies, procedures, documents, decisions,
   * projects and explanatory questions.
   */
  const semanticEnabled =
    isSemanticIntent ||
    !structuredEnabled ||
    question_type === "explanation" ||
    question_type === "summary";

  /*
   * Hybrid mode is used when both structured and semantic
   * evidence can contribute to the answer.
   */
  let mode: RetrievalMode;

  if (structuredEnabled && semanticEnabled) {
    mode = "hybrid";
    reasons.push(
      "The question can benefit from both structured records and semantic document knowledge."
    );
  } else if (structuredEnabled) {
    mode = "structured";
    reasons.push(
      "The question targets a structured organizational record."
    );
  } else {
    mode = "semantic";
    reasons.push(
      "The question requires semantic organizational knowledge."
    );
  }

  /*
   * Build structured search terms.
   *
   * The entity is normally the most useful exact-search
   * value for structured records.
   */
  const structuredSearchTerms: string[] = [];

  if (entity) {
    structuredSearchTerms.push(entity);
  }

  /*
   * Account numbers and other exact identifiers may already
   * be present in the language engine's search terms.
   */
  for (const term of search_terms) {
    if (
      term &&
      !structuredSearchTerms.some(
        (existing) =>
          existing.toLowerCase() === term.toLowerCase()
      )
    ) {
      structuredSearchTerms.push(term);
    }
  }

  /*
   * Semantic queries.
   *
   * Keep the original search terms because the embedding
   * model can use the natural language context better than
   * an aggressively reduced query.
   */
  const semanticQueries: string[] = [];

  if (entity) {
    semanticQueries.push(
      `${entity} ${requested_field !== "unknown" ? requested_field : ""}`.trim()
    );
  }

  for (const term of search_terms) {
    if (
      term &&
      !semanticQueries.some(
        (existing) =>
          existing.toLowerCase() === term.toLowerCase()
      )
    ) {
      semanticQueries.push(term);
    }
  }

  /*
   * Always retain at least one semantic query.
   */
  if (semanticQueries.length === 0) {
    semanticQueries.push(
      `${intent} ${requested_field}`.trim()
    );
  }

  /*
   * Keep retrieval reasonably small at this stage.
   * The hybrid layer can merge and rerank these results.
   */
  const limit =
    question_type === "list" ||
    question_type === "summary"
      ? 10
      : 5;

  return {
    mode,

    searchTerms: search_terms,

    entity,

    intent,

    requestedField: requested_field,

    limit,

    structured: {
      enabled: structuredEnabled,
      searchTerms: structuredSearchTerms,
      recordType: null,
    },

    semantic: {
      enabled: semanticEnabled,
      queries: semanticQueries,
    },

    reason: reasons,
  };
}