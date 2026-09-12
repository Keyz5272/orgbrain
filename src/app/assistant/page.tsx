"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  HiOutlineSparkles,
  HiOutlinePaperClip,
  HiOutlineExternalLink,
  HiOutlineDownload,
  HiOutlineChevronDown,
  HiOutlineCheckCircle,
  HiOutlineExclamationCircle,
  HiOutlineQuestionMarkCircle,
  HiOutlineDocumentText,
  HiOutlineTable,
  HiOutlineSearch,
} from "react-icons/hi";

type AnswerStatus = "supported" | "inferred" | "unknown";

type Citation = {
  filename: string | null;
  page: number | null;
  sheet: string | null;
  row: number | null;
  startTimestamp: number | null;
  endTimestamp: number | null;
};

type EvidenceSource = {
  id: string;
  source_id: string;
  source_type: string;
  filename: string | null;
  title: string | null;
  content_type: string;
  content: string | null;
  structured_data: Record<string, unknown> | null;
  page_number: number | null;
  sheet_name: string | null;
  row_number: number | null;
  start_timestamp: number | null;
  end_timestamp: number | null;
  section: string | null;
  metadata: Record<string, unknown> | null;
  similarity: number | null;
};

type Evidence = {
  source: EvidenceSource;
  citation: Citation;
};

type AnswerResponse = {
  success: boolean;
  answer: string;
  status: AnswerStatus;
  confidence: number;
  evidenceStrength?: string;
  evidence: Evidence[];
  reason?: string;
  model?: string;
  error?: string;
};

const EXAMPLE_QUESTIONS = [
  "What is the account number of Josephine Osae?",
  "What is the available balance of Josephine Osae?",
  "Where is ADEVAG Micro Credit Enterprise located?",
  "What information do we have about ADEVAG?",
];

const FIELD_LABELS: Record<string, string> = {
  account_number: "Account Number",
  account_name: "Account Name",
  customer_name: "Customer Name",
  open_date: "Open Date",
  avail_balance: "Available Balance",
  available_balance: "Available Balance",
  un_cleared_balance: "Uncleared Balance",
  uncleared_balance: "Uncleared Balance",
  department: "Department",
  contact: "Contact",
  amount: "Amount",
  date: "Date",
  type: "Type",
  action: "Action",
};

function formatConfidence(value: number) {
  const percentage = value <= 1 ? value * 100 : value;

  if (percentage >= 90) return `${percentage.toFixed(0)}%`;
  if (percentage >= 70) return `${percentage.toFixed(0)}%`;
  return `${percentage.toFixed(0)}%`;
}

function getConfidenceLabel(value: number) {
  const percentage = value <= 1 ? value * 100 : value;

  if (percentage >= 90) return "Very High";
  if (percentage >= 75) return "High";
  if (percentage >= 60) return "Moderate";
  if (percentage > 0) return "Low";

  return "None";
}

function normalizeStatus(status?: string): AnswerStatus {
  const value = String(status || "").toLowerCase();

  if (value === "supported") return "supported";
  if (value === "inferred") return "inferred";

  return "unknown";
}

function getStatusConfig(status: AnswerStatus) {
  switch (status) {
    case "supported":
      return {
        label: "Supported",
        icon: HiOutlineCheckCircle,
        classes:
          "bg-emerald-50 text-emerald-700 border-emerald-200",
      };

    case "inferred":
      return {
        label: "Inferred",
        icon: HiOutlineExclamationCircle,
        classes:
          "bg-amber-50 text-amber-700 border-amber-200",
      };

    default:
      return {
        label: "Unknown",
        icon: HiOutlineQuestionMarkCircle,
        classes:
          "bg-slate-100 text-slate-600 border-slate-200",
      };
  }
}

function getSourceTypeLabel(sourceType?: string) {
  if (!sourceType) return "Source";

  return sourceType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getContentTypeIcon(contentType?: string) {
  if (
    contentType === "row" ||
    contentType === "cell" ||
    contentType === "table"
  ) {
    return HiOutlineTable;
  }

  return HiOutlineDocumentText;
}

function formatTimestamp(value: number | null | undefined) {
  if (value === null || value === undefined) return null;

  const totalSeconds = Math.round(value);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      seconds
    ).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function getStructuredEntries(
  data: Record<string, unknown> | null | undefined
) {
  if (!data) return [];

  return Object.entries(data).filter(
    ([key, value]) =>
      !key.startsWith("_") &&
      value !== null &&
      value !== undefined &&
      String(value).trim() !== ""
  );
}

function getSourceLocation(evidence: Evidence) {
  const { citation } = evidence;

  if (citation.page !== null) {
    return `Page ${citation.page}`;
  }

  if (citation.sheet) {
    if (citation.row !== null) {
      return `${citation.sheet} · Row ${citation.row}`;
    }

    return citation.sheet;
  }

  if (
    citation.startTimestamp !== null &&
    citation.endTimestamp !== null
  ) {
    const start = formatTimestamp(citation.startTimestamp);
    const end = formatTimestamp(citation.endTimestamp);

    if (start && end) {
      return `${start} – ${end}`;
    }
  }

  if (citation.row !== null) {
    return `Row ${citation.row}`;
  }

  return null;
}

export default function AssistantPage() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] =
    useState<AnswerResponse | null>(null);
  const [error, setError] = useState("");
  const [showEvidence, setShowEvidence] = useState(true);
  const [expandedEvidence, setExpandedEvidence] =
    useState<string | null>(null);

  const status = normalizeStatus(response?.status);

  const statusConfig = getStatusConfig(status);
  const StatusIcon = statusConfig.icon;

  const evidence = response?.evidence || [];

  const uniqueSources = useMemo(() => {
    const map = new Map<string, Evidence>();

    for (const item of evidence) {
      const sourceId = item.source.source_id || item.source.id;

      if (!map.has(sourceId)) {
        map.set(sourceId, item);
      }
    }

    return Array.from(map.values());
  }, [evidence]);

  async function askQuestion(
    submittedQuestion?: string
  ) {
    const query = (
      submittedQuestion ?? question
    ).trim();

    if (!query) {
      setError("Please enter a question.");
      return;
    }

    setQuestion(query);
    setLoading(true);
    setError("");
    setResponse(null);
    setExpandedEvidence(null);

    try {
      const result = await fetch(
        "/api/knowledge/answer-universal",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            question: query,
            limit: 10,
          }),
        }
      );

      const data = await result.json();

      if (!result.ok || !data.success) {
        throw new Error(
          data.error ||
            "The knowledge assistant could not answer the question."
        );
      }

      setResponse(data);
    } catch (err) {
      console.error("Assistant error:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while processing your question."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await askQuestion();
  }

  function handleExample(questionText: string) {
    askQuestion(questionText);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
              <HiOutlineSparkles className="h-6 w-6" />
            </div>

            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Knowledge Assistant
              </h1>

              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                Ask questions about your organization&apos;s
                knowledge and receive answers backed by evidence.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Question panel */}
          <div className="lg:col-span-1">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <div className="flex items-center gap-2">
                  <HiOutlineSearch className="h-5 w-5 text-blue-600" />

                  <h2 className="font-semibold text-slate-900">
                    Ask your organization
                  </h2>
                </div>

                <p className="mt-1 text-sm text-slate-500">
                  The assistant searches your organization&apos;s
                  processed knowledge.
                </p>
              </div>

              <form
                onSubmit={handleSubmit}
                className="p-5"
              >
                <label
                  htmlFor="question"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Question
                </label>

                <textarea
                  id="question"
                  value={question}
                  onChange={(event) =>
                    setQuestion(event.target.value)
                  }
                  placeholder="e.g. What is the account number of Josephine Osae?"
                  rows={7}
                  disabled={loading}
                  className="w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50"
                />

                <button
                  type="submit"
                  disabled={loading || !question.trim()}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Searching knowledge...
                    </>
                  ) : (
                    <>
                      <HiOutlineSparkles className="h-5 w-5" />
                      Ask Assistant
                    </>
                  )}
                </button>
              </form>

              {/* Examples */}
              <div className="border-t border-slate-200 p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Example questions
                </p>

                <div className="space-y-2">
                  {EXAMPLE_QUESTIONS.map(
                    (example) => (
                      <button
                        key={example}
                        type="button"
                        disabled={loading}
                        onClick={() =>
                          handleExample(example)
                        }
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {example}
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>

            {/* Architecture note */}
            <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
              <div className="flex gap-3">
                <HiOutlineSparkles className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />

                <div>
                  <p className="text-sm font-semibold text-blue-900">
                    Evidence-first AI
                  </p>

                  <p className="mt-1 text-xs leading-5 text-blue-700">
                    OrgBrain only presents organizational
                    answers when sufficient organizational
                    evidence has been found.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Answer panel */}
          <div className="lg:col-span-2">
            {!response && !loading && !error && (
              <div className="flex min-h-[500px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white">
                <div className="max-w-md px-6 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                    <HiOutlineSparkles className="h-8 w-8" />
                  </div>

                  <h2 className="mt-5 text-lg font-semibold text-slate-900">
                    Ask OrgBrain a question
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Your answer will be generated from the
                    organization&apos;s indexed knowledge and
                    accompanied by source evidence.
                  </p>
                </div>
              </div>
            )}

            {loading && (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex min-h-[500px] flex-col items-center justify-center px-6 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50">
                    <span className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
                  </div>

                  <h2 className="mt-5 text-lg font-semibold text-slate-900">
                    Searching organizational memory
                  </h2>

                  <p className="mt-2 max-w-md text-sm text-slate-500">
                    OrgBrain is retrieving relevant knowledge,
                    checking the evidence, and preparing the
                    answer.
                  </p>
                </div>
              </div>
            )}

            {error && !loading && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
                <div className="flex gap-4">
                  <HiOutlineExclamationCircle className="h-6 w-6 shrink-0 text-red-600" />

                  <div>
                    <h2 className="font-semibold text-red-900">
                      Unable to answer
                    </h2>

                    <p className="mt-1 text-sm leading-6 text-red-700">
                      {error}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {response && !loading && (
              <div className="space-y-5">
                {/* Answer */}
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                          Answer
                        </p>

                        <p className="mt-1 text-sm text-slate-500">
                          {evidence.length > 0
                            ? `${evidence.length} verified evidence item${
                                evidence.length === 1
                                  ? ""
                                  : "s"
                              }`
                            : "No supporting evidence found"}
                        </p>
                      </div>

                      <div
                        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${statusConfig.classes}`}
                      >
                        <StatusIcon className="h-4 w-4" />
                        {statusConfig.label}
                      </div>
                    </div>
                  </div>

                  <div className="p-5 sm:p-6">
                    <div className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800">
                      {response.answer}
                    </div>
                  </div>
                </div>

                {/* Verification summary */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      Status
                    </p>

                    <div className="mt-2 flex items-center gap-2">
                      <StatusIcon className="h-5 w-5 text-slate-600" />

                      <span className="font-semibold capitalize text-slate-900">
                        {status}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      Confidence
                    </p>

                    <p className="mt-2 font-semibold text-slate-900">
                      {formatConfidence(
                        response.confidence || 0
                      )}
                    </p>

                    <p className="mt-0.5 text-xs text-slate-500">
                      {getConfidenceLabel(
                        response.confidence || 0
                      )}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      Evidence
                    </p>

                    <p className="mt-2 font-semibold text-slate-900">
                      {evidence.length}
                    </p>

                    <p className="mt-0.5 text-xs text-slate-500">
                      {uniqueSources.length} source
                      {uniqueSources.length === 1
                        ? ""
                        : "s"}
                    </p>
                  </div>
                </div>

                {/* Reason */}
                {response.reason && (
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="flex gap-3">
                      <HiOutlineQuestionMarkCircle className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />

                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          Verification note
                        </h3>

                        <p className="mt-1 text-sm leading-6 text-slate-600">
                          {response.reason}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Evidence */}
                {evidence.length > 0 && (
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <button
                      type="button"
                      onClick={() =>
                        setShowEvidence(
                          (current) => !current
                        )
                      }
                      className="flex w-full items-center justify-between border-b border-slate-200 px-5 py-4 text-left transition hover:bg-slate-50 sm:px-6"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                          <HiOutlineDocumentText className="h-5 w-5" />
                        </div>

                        <div>
                          <h2 className="font-semibold text-slate-900">
                            Evidence & Sources
                          </h2>

                          <p className="text-xs text-slate-500">
                            Information used to support the answer
                          </p>
                        </div>
                      </div>

                      <HiOutlineChevronDown
                        className={`h-5 w-5 text-slate-400 transition-transform ${
                          showEvidence
                            ? "rotate-180"
                            : ""
                        }`}
                      />
                    </button>

                    {showEvidence && (
                      <div className="divide-y divide-slate-100">
                        {evidence.map(
                          (item, index) => {
                            const source = item.source;
                            const structured =
                              getStructuredEntries(
                                source.structured_data
                              );

                            const ContentIcon =
                              getContentTypeIcon(
                                source.content_type
                              );

                            const sourceId =
                              source.source_id ||
                              source.id;

                            const location =
                              getSourceLocation(item);

                            const similarity =
                              source.similarity ?? 0;

                            const percentage =
                              similarity <= 1
                                ? similarity * 100
                                : similarity;

                            const isExpanded =
                              expandedEvidence ===
                              source.id;

                            return (
                              <div
                                key={`${source.id}-${index}`}
                                className="p-5 sm:p-6"
                              >
                                <div className="flex items-start gap-3">
                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                                    <ContentIcon className="h-5 w-5" />
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                      <div className="min-w-0">
                                        <h3 className="truncate text-sm font-semibold text-slate-900">
                                          {source.filename ||
                                            source.title ||
                                            "Organizational source"}
                                        </h3>

                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                          <span>
                                            {getSourceTypeLabel(
                                              source.source_type
                                            )}
                                          </span>

                                          {location && (
                                            <>
                                              <span>
                                                •
                                              </span>

                                              <span>
                                                {location}
                                              </span>
                                            </>
                                          )}

                                          {source.section && (
                                            <>
                                              <span>
                                                •
                                              </span>

                                              <span>
                                                {source.section}
                                              </span>
                                            </>
                                          )}
                                        </div>
                                      </div>

                                      <div className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                                        {percentage.toFixed(
                                          0
                                        )}
                                        % match
                                      </div>
                                    </div>

                                    {/* Content */}
                                    {source.content && (
                                      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                                        <p
                                          className={`whitespace-pre-wrap text-sm leading-6 text-slate-700 ${
                                            !isExpanded
                                              ? "line-clamp-5"
                                              : ""
                                          }`}
                                        >
                                          {source.content}
                                        </p>

                                        {source.content.length >
                                          500 && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setExpandedEvidence(
                                                isExpanded
                                                  ? null
                                                  : source.id
                                              )
                                            }
                                            className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700"
                                          >
                                            {isExpanded
                                              ? "Show less"
                                              : "Show more"}
                                          </button>
                                        )}
                                      </div>
                                    )}

                                    {/* Structured data */}
                                    {structured.length >
                                      0 && (
                                      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                                        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            Structured data
                                          </p>
                                        </div>

                                        <div className="divide-y divide-slate-100">
                                          {structured.map(
                                            ([key, value]) => (
                                              <div
                                                key={key}
                                                className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4"
                                              >
                                                <div className="text-xs font-medium text-slate-500">
                                                  {FIELD_LABELS[
                                                    key
                                                  ] ||
                                                    key.replace(
                                                      /_/g,
                                                      " "
                                                    )}
                                                </div>

                                                <div className="break-words text-sm font-medium text-slate-800 sm:col-span-2">
                                                  {formatValue(
                                                    value
                                                  )}
                                                </div>
                                              </div>
                                            )
                                          )}
                                        </div>
                                      </div>
                                    )}

                                    {/* Source actions */}
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                      <a
                                        href={`/api/knowledge/sources/${sourceId}/open`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                                      >
                                        <HiOutlineExternalLink className="h-4 w-4" />
                                        Open Source
                                      </a>

                                      <a
                                        href={`/api/knowledge/sources/${sourceId}/download`}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                                      >
                                        <HiOutlineDownload className="h-4 w-4" />
                                        Download
                                      </a>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* No evidence */}
                {evidence.length === 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-6">
                    <div className="flex gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                        <HiOutlineQuestionMarkCircle className="h-5 w-5 text-slate-500" />
                      </div>

                      <div>
                        <h3 className="font-semibold text-slate-900">
                          No verified evidence
                        </h3>

                        <p className="mt-1 text-sm leading-6 text-slate-500">
                          OrgBrain could not find sufficient
                          organizational evidence to support an
                          answer to this question. No unsupported
                          organizational information has been
                          presented as fact.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Footer metadata */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-slate-400">
                  <div className="flex items-center gap-2">
                    <HiOutlinePaperClip className="h-4 w-4" />

                    <span>
                      {uniqueSources.length} source
                      {uniqueSources.length === 1
                        ? ""
                        : "s"} used
                    </span>
                  </div>

                  {response.model && (
                    <span>
                      Model: {response.model}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}