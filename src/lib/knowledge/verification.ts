export type EvidenceCandidate = {
  id: string;
  source_id: string;
  source_type: string;
  filename: string | null;
  title: string | null;
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

  similarity: number;
};

export type VerificationStatus =
  | "supported"
  | "inferred"
  | "unknown";

export type EvidenceStrength =
  | "strong"
  | "moderate"
  | "weak"
  | "none";

export type VerifiedEvidence = {
  status: VerificationStatus;
  confidence: number;
  evidenceStrength: EvidenceStrength;

  evidence: EvidenceCandidate | null;

  supportingEvidence: EvidenceCandidate[];

  reason: string;
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
   SEARCHABLE CONTENT
========================================================= */

function getSearchableText(
  candidate: EvidenceCandidate
): string {
  const structured =
    candidate.structured_data
      ? JSON.stringify(
          candidate.structured_data
        )
      : "";

  return normalize(
    [
      candidate.content,
      candidate.section,
      candidate.title,
      structured,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

/* =========================================================
   QUESTION KEYWORDS
========================================================= */

function getQuestionKeywords(
  question: string
): string[] {
  const stopWords = new Set([
    "what",
    "where",
    "when",
    "which",
    "who",
    "whom",
    "whose",
    "does",
    "did",
    "have",
    "has",
    "with",
    "from",
    "that",
    "this",
    "their",
    "there",
    "about",
    "into",
    "give",
    "show",
    "tell",
    "find",
    "please",
    "account",
    "information",
    "organization",
    "organizational",
    "what",
    "know",
    "known",
    "do",
    "we",
  ]);

  return Array.from(
    new Set(
      normalize(question)
        .split(/\s+/)
        .filter(
          (word) =>
            word.length >= 4 &&
            !stopWords.has(word)
        )
    )
  );
}

/* =========================================================
   ENTITY EXTRACTION
========================================================= */

function extractLikelyEntity(
  question: string
): string | null {
  const normalized =
    normalize(question);

    // =========================================================
// PRIORITY ACCOUNT ENTITY EXTRACTION
// Handles:
// "What is the balance of Josephine Osae's account?"
// =========================================================

const accountMatch =
  normalized.match(
    /\b(?:of|for)\s+(.+?)\s+(?:account|balance|account number|contact|phone|telephone|id)\b/i
  );

if (accountMatch?.[1]) {
  const entity =
    accountMatch[1]
      .replace(/\s+s$/i, "")
      .trim();

  if (
    entity.length >= 3 &&
    entity.split(/\s+/).length <= 8
  ) {
    return entity;
  }
}

  /*
   * -------------------------------------------------------
   * Pattern:
   *
   * "What is the account number of Josephine Osae?"
   *
   * Extract everything after "of".
   * -------------------------------------------------------
   */

  const ofMatch = normalized.match(
    /\b(?:of|for)\s+(.+)$/
  );

  if (ofMatch?.[1]) {
    const entity = ofMatch[1]
      .replace(
        /\b(account|number|balance|contact|phone|telephone|id)\b/g,
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
   * -------------------------------------------------------
   * Pattern:
   *
   * "What is Josephine Osae's account number?"
   * -------------------------------------------------------
   */

  const possessiveMatch =
    normalized.match(
      /\bwhat(?:'s| is)\s+(.+?)\s+(?:account number|account|balance|contact|phone number|telephone|id)\b/
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

  /*
   * -------------------------------------------------------
   * Pattern:
   *
   * "What information do we have about ADEVAG?"
   * -------------------------------------------------------
   */

  const aboutMatch =
    normalized.match(
      /\babout\s+(.+)$/
    );

  if (aboutMatch?.[1]) {
    const entity =
      aboutMatch[1]
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

  /*
   * -------------------------------------------------------
   * Generic fallback.
   * -------------------------------------------------------
   */

  const cleaned =
    normalized
      .replace(
        /\bwhat information do we have about\b/g,
        ""
      )
      .replace(
        /\bwhat information do we know about\b/g,
        ""
      )
      .replace(
        /\bwhat is\b/g,
        ""
      )
      .replace(
        /\bwhat's\b/g,
        ""
      )
      .replace(
        /\bwhere is\b/g,
        ""
      )
      .replace(
        /\bwho is\b/g,
        ""
      )
      .replace(
        /\bthe\b/g,
        ""
      )
      .replace(
        /\baccount number\b/g,
        ""
      )
      .replace(
        /\baccount\b/g,
        ""
      )
      .replace(
        /\bnumber\b/g,
        ""
      )
      .replace(
        /\bbalance\b/g,
        ""
      )
      .replace(
        /\bavailable\b/g,
        ""
      )
      .replace(
        /\buncleared\b/g,
        ""
      )
      .replace(
        /\blocated\b/g,
        ""
      )
      .replace(
        /\blocation\b/g,
        ""
      )
      .replace(
        /\binformation\b/g,
        ""
      )
      .replace(
        /\bof\b/g,
        ""
      )
      .replace(
        /\bfor\b/g,
        ""
      )
      .replace(
        /\bis\b/g,
        ""
      )
      .replace(
        /\bdoes\b/g,
        ""
      )
      .replace(
        /\bhave\b/g,
        ""
      )
      .replace(
        /\bhas\b/g,
        ""
      )
      .replace(
        /\bdo we\b/g,
        ""
      )
      .replace(
        /\bwe\b/g,
        ""
      )
      .replace(
        /\babout\b/g,
        ""
      )
      .trim();

  if (
    !cleaned ||
    cleaned.length < 3 ||
    cleaned.split(/\s+/).length > 8
  ) {
    return null;
  }

  return cleaned;
}

/* =========================================================
   ENTITY MATCH
========================================================= */

function candidateContainsEntity(
  candidate: EvidenceCandidate,
  entity: string | null
): boolean {
  if (!entity) {
    return false;
  }

  const normalizedEntity =
    normalize(entity);

  if (!normalizedEntity) {
    return false;
  }

  /*
   * Search normal textual evidence.
   */
  const searchable =
    getSearchableText(candidate);

  if (
    searchable.includes(
      normalizedEntity
    )
  ) {
    return true;
  }

  /*
   * Explicitly inspect structured data.
   *
   * This is particularly important for:
   *
   * - spreadsheets
   * - account records
   * - customer records
   * - employee records
   * - database exports
   */
  const structured =
    candidate.structured_data;

  if (structured) {
    for (const value of Object.values(
      structured
    )) {
      if (
        typeof value === "string" &&
        normalize(value).includes(
          normalizedEntity
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

/* =========================================================
   VERIFICATION SCORE
========================================================= */

function calculateVerificationScore(
  candidate: EvidenceCandidate,
  question: string
): number {
  const searchable =
    getSearchableText(candidate);

  const normalizedQuestion =
    normalize(question);

  if (
    !searchable ||
    !normalizedQuestion
  ) {
    return 0;
  }

  /*
   * Base semantic similarity.
   */
  let score =
    Math.max(
      0,
      Math.min(
        1,
        candidate.similarity
      )
    ) * 100;

  /*
   * Exact question phrase.
   */
  if (
    searchable.includes(
      normalizedQuestion
    )
  ) {
    score += 40;
  }

  /*
   * Question keywords.
   */
  const keywords =
    getQuestionKeywords(
      question
    );

  let matchedKeywords = 0;

  for (const keyword of keywords) {
    if (
      searchable.includes(keyword)
    ) {
      matchedKeywords++;
    }
  }

  if (keywords.length > 0) {
    score +=
      (matchedKeywords /
        keywords.length) *
      30;
  }

  return score;
}

/* =========================================================
   SUPPORTING EVIDENCE
========================================================= */

function findSupportingEvidence(
  best: EvidenceCandidate,
  ranked: {
    candidate: EvidenceCandidate;
    score: number;
  }[]
): EvidenceCandidate[] {
  /*
   * Supporting evidence MUST come from
   * the same source.
   */
  const sameSource =
    ranked.filter(
      (item) =>
        item.candidate.source_id ===
        best.source_id
    );

  /*
   * Exclude primary evidence.
   */
  const others =
    sameSource.filter(
      (item) =>
        item.candidate.id !==
        best.id
    );

  /*
   * Source-expanded evidence can have
   * similarity = 0.
   *
   * That is intentional and must NOT
   * automatically exclude the evidence.
   */
  return others
    .filter((item) => {
      const hasContent =
        Boolean(
          item.candidate.content?.trim()
        );

      const hasStructuredData =
        Object.keys(
          item.candidate
            .structured_data ?? {}
        ).length > 0;

      return (
        hasContent ||
        hasStructuredData
      );
    })
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(0, 10)
    .map(
      (item) =>
        item.candidate
    );
}

/* =========================================================
   SOURCE COHERENCE
========================================================= */

function calculateSourceCoherence(
  best: EvidenceCandidate,
  supportingEvidence: EvidenceCandidate[]
): number {
  /*
   * Primary evidence + supporting
   * evidence all belong to the same source.
   */
  const totalEvidence =
    1 +
    supportingEvidence.length;

  if (totalEvidence >= 5) {
    return 1;
  }

  if (totalEvidence === 4) {
    return 0.95;
  }

  if (totalEvidence === 3) {
    return 0.9;
  }

  if (totalEvidence === 2) {
    return 0.8;
  }

  return 0;
}

/* =========================================================
   EXACT LOOKUP DETECTION
========================================================= */

function isExactLookupQuestion(
  question: string
): boolean {
  return /\b(account number|account|balance|contact|phone number|telephone|employee id|customer id|open date|available balance|uncleared balance)\b/i.test(
    question
  );
}

/* =========================================================
   BROAD KNOWLEDGE QUESTION
========================================================= */

function isBroadKnowledgeQuestion(
  question: string
): boolean {
  const normalized =
    normalize(question);

  return (
    normalized.includes(
      "what information"
    ) ||
    normalized.includes(
      "tell me about"
    ) ||
    normalized.includes(
      "what do we know"
    ) ||
    normalized.includes(
      "information about"
    ) ||
    normalized.includes(
      "give me information"
    )
  );
}

/* =========================================================
   CONFIDENCE
========================================================= */

function getConfidence(
  candidate: EvidenceCandidate,
  verificationScore: number,
  supportingEvidenceCount: number,
  broadQuestion: boolean
): number {
  const similarity =
    Math.max(
      0,
      Math.min(
        1,
        candidate.similarity
      )
    );

  const textualStrength =
    Math.min(
      1,
      verificationScore / 100
    );

  /*
   * Base confidence.
   */
  let confidence =
    similarity * 0.55 +
    textualStrength * 0.25;

  /*
   * Supporting evidence bonus.
   */
  if (
    supportingEvidenceCount > 0
  ) {
    confidence += Math.min(
      0.15,
      supportingEvidenceCount *
        0.05
    );
  }

  /*
   * Broad questions can legitimately
   * combine several chunks from the
   * same source.
   */
  if (
    broadQuestion &&
    supportingEvidenceCount >= 2
  ) {
    confidence += 0.12;
  }

  /*
   * Three or more supporting chunks
   * indicate strong source coherence.
   */
  if (
    supportingEvidenceCount >= 3
  ) {
    confidence += 0.08;
  }

  return Number(
    Math.min(
      0.99,
      Math.max(
        0,
        confidence
      )
    ).toFixed(4)
  );
}

/* =========================================================
   MAIN VERIFICATION
========================================================= */

export function verifyEvidence(
  question: string,
  candidates: EvidenceCandidate[]
): VerifiedEvidence {
  /*
   * No question or evidence.
   */
  if (
    !question.trim() ||
    candidates.length === 0
  ) {
    return {
      status: "unknown",
      confidence: 0,
      evidenceStrength: "none",
      evidence: null,
      supportingEvidence: [],
      reason:
        "No evidence was available.",
    };
  }

  /*
   * Determine question type.
   */
  const exactLookupQuestion =
    isExactLookupQuestion(
      question
    );

  const broadQuestion =
    isBroadKnowledgeQuestion(
      question
    );

  /*
   * Extract requested entity.
   */
  const likelyEntity =
    extractLikelyEntity(
      question
    );

  /* =======================================================
     RANK CANDIDATES
  ======================================================= */

  const ranked =
    candidates
      .map((candidate) => {
        const entityMatch =
          candidateContainsEntity(
            candidate,
            likelyEntity
          );

        let score =
          calculateVerificationScore(
            candidate,
            question
          );

        /*
         * Entity bonus.
         */
        if (entityMatch) {
          score += 50;
        }

        return {
          candidate,
          score,
          entityMatch,
        };
      })
      .sort((a, b) => {
        /*
         * CRITICAL:
         *
         * For exact entity lookups, a candidate
         * containing the requested entity MUST
         * outrank a semantically similar candidate
         * that does not contain the entity.
         *
         * Example:
         *
         * Josephine Osae candidate = similarity .31
         * unrelated Fiscus candidate = similarity .62
         *
         * Josephine must win.
         */
        if (
          exactLookupQuestion &&
          a.entityMatch !==
            b.entityMatch
        ) {
          return a.entityMatch
            ? -1
            : 1;
        }

        return b.score - a.score;
      });

  const best =
    ranked[0];

  if (!best) {
    return {
      status: "unknown",
      confidence: 0,
      evidenceStrength: "none",
      evidence: null,
      supportingEvidence: [],
      reason:
        "No verifiable evidence was found.",
    };
  }

  /* =======================================================
     EXACT ENTITY LOOKUP PROTECTION
  ======================================================= */

  if (
    exactLookupQuestion &&
    likelyEntity &&
    !best.entityMatch
  ) {
    return {
      status: "unknown",
      confidence: 0,
      evidenceStrength: "none",
      evidence: null,
      supportingEvidence: [],
      reason:
        `The requested entity "${likelyEntity}" was not found in the retrieved organizational evidence.`,
    };
  }

  /* =======================================================
     FIND SUPPORTING EVIDENCE
  ======================================================= */

  const supportingEvidence =
    findSupportingEvidence(
      best.candidate,
      ranked
    );

  const supportingCount =
    supportingEvidence.length;

  /* =======================================================
     SOURCE COHERENCE
  ======================================================= */

  const sourceCoherence =
    calculateSourceCoherence(
      best.candidate,
      supportingEvidence
    );

  /* =======================================================
     CONFIDENCE
  ======================================================= */

  const confidence =
    getConfidence(
      best.candidate,
      best.score,
      supportingCount,
      broadQuestion
    );

  const similarity =
    Math.max(
      0,
      Math.min(
        1,
        best.candidate.similarity
      )
    );

  /* =======================================================
     STRONG DIRECT EVIDENCE
  ======================================================= */

  if (
    similarity >= 0.65 &&
    best.score >= 65
  ) {
    return {
      status: "supported",
      confidence,
      evidenceStrength: "strong",
      evidence:
        best.candidate,
      supportingEvidence,
      reason:
        supportingCount > 0
          ? "The retrieved source strongly matches the question and contains additional supporting content from the same source."
          : "The retrieved source strongly matches the question and provides direct organizational evidence.",
    };
  }

  /* =======================================================
     BROAD QUESTION + SAME SOURCE EVIDENCE
     
     Example:
     
     "What information do we have about ADEVAG?"
     
     One source can contain:
     
     Chunk 1:
     ADEVAG MICRO CREDIT ENTERPRISE
     
     Chunk 2:
     SUHUM AYEKOTSE
     
     Chunk 3:
     OPPOSITE UPPER MANYA KROBO RURAL BANK
     
     Chunk 4:
     TEL: 0248265274 / 0248817636
  ======================================================= */

  if (
    broadQuestion &&
    best.entityMatch &&
    supportingCount >= 2 &&
    sourceCoherence >= 0.9
  ) {
    return {
      status: "supported",
      confidence: Math.max(
        0.85,
        confidence
      ),
      evidenceStrength: "strong",
      evidence:
        best.candidate,
      supportingEvidence,
      reason:
        "Multiple complementary pieces of organizational evidence from the same source support the answer.",
    };
  }

  /* =======================================================
     GENERAL MULTI-CHUNK SUPPORT
  ======================================================= */

  if (
    !exactLookupQuestion &&
    supportingCount >= 3 &&
    sourceCoherence >= 0.9 &&
    best.score >= 40
  ) {
    return {
      status: "supported",
      confidence: Math.max(
        0.85,
        confidence
      ),
      evidenceStrength: "strong",
      evidence:
        best.candidate,
      supportingEvidence,
      reason:
        "Multiple complementary pieces of evidence from the same organizational source provide sufficient support for the answer.",
    };
  }

  /* =======================================================
     MODERATE EVIDENCE
  ======================================================= */

  if (
    similarity >= 0.4 &&
    best.score >= 40
  ) {
    /*
     * Exact lookup questions require
     * direct evidence.
     */
    if (
      exactLookupQuestion
    ) {
      return {
        status: "unknown",
        confidence: 0,
        evidenceStrength: "moderate",
        evidence: null,
        supportingEvidence: [],
        reason:
          "The evidence is relevant but does not provide sufficient direct support for this exact lookup.",
      };
    }

    /*
     * General questions can be inferred
     * from moderate evidence.
     */
    return {
      status: "inferred",
      confidence,
      evidenceStrength:
        "moderate",
      evidence:
        best.candidate,
      supportingEvidence,
      reason:
        supportingCount > 0
          ? "The retrieved source is relevant and has supporting content, but the evidence is not strong enough for a fully supported conclusion."
          : "The retrieved source is relevant, but the evidence is not strong enough for a fully supported conclusion.",
    };
  }

  /* =======================================================
     WEAK EVIDENCE
  ======================================================= */

  if (
    similarity >= 0.3
  ) {
    return {
      status: "unknown",
      confidence: 0,
      evidenceStrength: "weak",
      evidence: null,
      supportingEvidence: [],
      reason:
        "Only weakly related evidence was retrieved. The information cannot be reliably supported.",
    };
  }

  /* =======================================================
     NONE
  ======================================================= */

  return {
    status: "unknown",
    confidence: 0,
    evidenceStrength: "none",
    evidence: null,
    supportingEvidence: [],
    reason:
      "The retrieved evidence is not sufficiently relevant to support the question.",
  };
}