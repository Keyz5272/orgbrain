// src/lib/knowledge/language/normalize.ts

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}'#\s.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeEntity(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanEntity(value: string): string {
  return value
    .replace(
      /^(the|a|an|customer|employee|staff|person|account|user)\s+/i,
      ""
    )
    .replace(
      /\s+(account|customer|employee|staff|number|balance|details?)$/i,
      ""
    )
    .trim();
}

export function cleanDomainEntity(value: string): string {
  return value
    .replace(
      /\b(transaction|transactions|transaction\s+details|transaction\s+record|transaction\s+information|payment|payments|payment\s+details|payment\s+record|payment\s+information)\b/gi,
      " "
    )
    .replace(/\b(record|details|information)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}