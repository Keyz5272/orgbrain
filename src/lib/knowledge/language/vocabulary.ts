// src/lib/knowledge/language/vocabulary.ts

export const LOOKUP_VERBS = [
  "find",
  "get",
  "show",
  "give",
  "retrieve",
  "lookup",
  "look up",
  "provide",
  "tell",
  "fetch",
  "check",
  "search",
  "locate",
  "identify",
  "display",
  "return",
  "bring",
  "pull",
  "obtain",
  "access",
  "view",
  "see",
  "know",
];

export const ACCOUNT_TERMS = [
  "account",
  "account number",
  "account no",
  "account #",
  "acct",
  "acct no",
  "acct number",
];

export const ACCOUNT_NUMBER_TERMS = [
  "account number",
  "account no",
  "account #",
  "acct number",
  "acct no",
  "account identifier",
];

export const BALANCE_TERMS = [
  "balance",
  "available balance",
  "current balance",
  "amount available",
  "funds available",
  "available funds",
  "account balance",
];

export const UNCLEARED_BALANCE_TERMS = [
  "uncleared balance",
  "uncleared amount",
  "uncleared funds",
  "uncleared",
];

export const OPEN_DATE_TERMS = [
  "open date",
  "opening date",
  "date opened",
  "when opened",
  "opening day",
];

export const CONTACT_TERMS = [
  "contact",
  "contact number",
  "phone",
  "phone number",
  "telephone",
  "telephone number",
  "mobile",
  "mobile number",
];

export const CUSTOMER_TERMS = [
  "customer",
  "client",
  "customer details",
  "client details",
];

export const EMPLOYEE_TERMS = [
  "employee",
  "staff",
  "worker",
  "personnel",
  "employee details",
  "staff details",
];

export const TRANSACTION_TERMS = [
  "transaction",
  "transactions",
  "transaction details",
  "transaction information",
  "transaction record",
  "transaction records",
  "payment",
  "payments",
  "payment details",
  "payment information",
  "payment record",
  "payment records",
];

export const POLICY_TERMS = [
  "policy",
  "policies",
  "rules",
  "regulation",
  "regulations",
  "guideline",
  "guidelines",
];

export const PROCEDURE_TERMS = [
  "procedure",
  "procedures",
  "process",
  "processes",
  "steps",
  "workflow",
  "workflows",
  "instructions",
];

export const DOCUMENT_TERMS = [
  "document",
  "file",
  "report",
  "letter",
  "spreadsheet",
  "pdf",
  "presentation",
];

export const DECISION_TERMS = [
  "decision",
  "decisions",
  "decided",
  "approval",
  "approvals",
  "approved",
  "resolution",
  "resolutions",
];

export const PROJECT_TERMS = [
  "project",
  "initiative",
  "programme",
  "program",
];

export const FIELD_ALIASES: Record<string, string[]> = {
  account_number: ACCOUNT_NUMBER_TERMS,

  account_name: [
    "account name",
    "name on account",
    "account holder",
    "account holder name",
  ],

  available_balance: BALANCE_TERMS,

  uncleared_balance: UNCLEARED_BALANCE_TERMS,

  open_date: OPEN_DATE_TERMS,

  contact: CONTACT_TERMS,

  customer_name: [
    "customer name",
    "client name",
    "customer",
    "client",
  ],

  employee_name: [
    "employee name",
    "staff name",
    "employee",
    "staff",
  ],

  department: [
    "department",
    "unit",
    "division",
    "section",
  ],

  amount: [
    "amount",
    "value",
    "money",
    "cost",
    "price",
    "total",
  ],

  date: [
  "date",
  "when",
  "day",
  "time",
],

policy: [
  "policy",
  "policies",
],

procedure: [
    "procedure",
    "procedures",
    "process",
    "processes",
    "steps",
    "workflow",
    "workflows",
    "instructions",
  ],

  decision: [
  "decision",
  "decisions",
  "decided",
  "approval",
  "approvals",
  "approved",
  "resolution",
  "resolutions",
],
};

export const INTENT_ALIASES: Record<string, string[]> = {
  account_lookup: [
    ...ACCOUNT_TERMS,
    ...ACCOUNT_NUMBER_TERMS,
    ...BALANCE_TERMS,
    ...UNCLEARED_BALANCE_TERMS,
    ...OPEN_DATE_TERMS,
  ],

  customer_lookup: CUSTOMER_TERMS,

  employee_lookup: EMPLOYEE_TERMS,

  transaction_lookup: TRANSACTION_TERMS,

  policy_lookup: POLICY_TERMS,

  procedure_lookup: PROCEDURE_TERMS,

  document_lookup: DOCUMENT_TERMS,

  decision_lookup: DECISION_TERMS,

  project_lookup: PROJECT_TERMS,
};

export const GENERAL_ORGANIZATION_TERMS = [
  "organization",
  "organisation",
  "company",
  "our organization",
  "our organisation",
  "our company",
  "organizational information",
  "organisation information",
  "company information",
  "organizational knowledge",
  "organisation knowledge",
  "company knowledge",
  "organizational overview",
  "organisation overview",
  "company overview",
  "what do we know",
  "what information do we have",
  "what knowledge do we have",
  "what information is available",
  "what knowledge is available",
  "what information is stored",
  "what is stored",
];
