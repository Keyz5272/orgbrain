"use client";

import { useState } from "react";

type Understanding = {
  entity: string | null;
  intent: string;
  requested_field: string | null;
  search_terms: string[];
  question_type: string;
};

type StructuredResult = {
  id: string;
  record_type: string;
  record_data: Record<string, unknown>;
  row_number: number | null;
  match_score: number;
  source: {
    document_id: string;
    filename: string | null;
    document_type: string | null;
    department: string | null;
    row_number: number | null;
  };
};

type SemanticResult = {
  id: string;
  document_id: string;
  filename: string;
  document_type: string | null;
  department: string | null;
  content: string;
  page_number: number | null;
  chunk_index: number;
  section: string | null;
  content_type: string | null;
  metadata: Record<string, unknown>;
  similarity: number;
};

export default function RetrieveTestPage() {
  const [question, setQuestion] = useState("");

  const [understanding, setUnderstanding] =
    useState<Understanding | null>(null);

  const [structuredResults, setStructuredResults] = useState<
    StructuredResult[]
  >([]);

  const [semanticResults, setSemanticResults] = useState<
    SemanticResult[]
  >([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSearch() {
    const cleanQuestion = question.trim();

    if (!cleanQuestion) {
      setError("Please enter a question.");
      return;
    }

    setLoading(true);
    setError("");

    setUnderstanding(null);
    setStructuredResults([]);
    setSemanticResults([]);

    try {
      // ============================================================
      // 1. QUESTION UNDERSTANDING
      // ============================================================

      const understandResponse = await fetch(
        "/api/knowledge/understand",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            question: cleanQuestion,
          }),
        }
      );

      const understandData = await understandResponse.json();

      if (!understandResponse.ok) {
        throw new Error(
          understandData.error ||
            "Question understanding failed."
        );
      }

      const parsedUnderstanding =
        understandData.understanding as Understanding;

      setUnderstanding(parsedUnderstanding);

      // ============================================================
      // 2. DETERMINE STRUCTURED SEARCH TERM
      // ============================================================

      const structuredSearchTerm =
        parsedUnderstanding.entity ||
        parsedUnderstanding.search_terms?.[0] ||
        cleanQuestion;

      // ============================================================
      // 3. RUN STRUCTURED + SEMANTIC RETRIEVAL
      // ============================================================

      const [structuredResponse, semanticResponse] =
        await Promise.all([
          fetch("/api/knowledge/structured-retrieve", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              searchTerm: structuredSearchTerm,
            }),
          }),

          fetch("/api/knowledge/retrieve", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              question: cleanQuestion,
            }),
          }),
        ]);

      const structuredData =
        await structuredResponse.json();

      const semanticData =
        await semanticResponse.json();

      if (!structuredResponse.ok) {
        throw new Error(
          structuredData.error ||
            "Structured retrieval failed."
        );
      }

      if (!semanticResponse.ok) {
        throw new Error(
          semanticData.error ||
            "Semantic retrieval failed."
        );
      }

      setStructuredResults(
        structuredData.results || []
      );

      setSemanticResults(
        semanticData.results || []
      );
    } catch (err: unknown) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  function formatValue(value: unknown) {
    if (value === null || value === undefined) {
      return "—";
    }

    if (typeof value === "object") {
      return JSON.stringify(value);
    }

    return String(value);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-6xl">

        {/* HEADER */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">
            OrgBrain Retrieval Test
          </h1>

          <p className="mt-2 text-slate-600">
            Test question understanding and hybrid knowledge
            retrieval.
          </p>
        </div>

        {/* QUESTION */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <label className="mb-2 block text-sm font-semibold text-slate-700">
            Ask OrgBrain
          </label>

          <div className="flex flex-col gap-3 md:flex-row">
            <input
              type="text"
              value={question}
              onChange={(e) =>
                setQuestion(e.target.value)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSearch();
                }
              }}
              placeholder="e.g. What is Josephine Osae's account number?"
              className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-blue-500"
            />

            <button
              onClick={handleSearch}
              disabled={loading}
              className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Processing..." : "Ask OrgBrain"}
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* QUESTION UNDERSTANDING */}
        {understanding && (
          <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
            <div className="mb-5">
              <h2 className="text-xl font-bold text-slate-900">
                Question Understanding
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                How OrgBrain interpreted the question.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-4">

              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Entity
                </p>

                <p className="mt-2 font-semibold text-slate-900">
                  {understanding.entity || "—"}
                </p>
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Intent
                </p>

                <p className="mt-2 font-semibold text-slate-900">
                  {understanding.intent}
                </p>
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Requested Field
                </p>

                <p className="mt-2 font-semibold text-slate-900">
                  {understanding.requested_field || "—"}
                </p>
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Question Type
                </p>

                <p className="mt-2 font-semibold text-slate-900">
                  {understanding.question_type}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Search Terms
              </p>

              <div className="mt-2 flex flex-wrap gap-2">
                {understanding.search_terms?.map(
                  (term, index) => (
                    <span
                      key={index}
                      className="rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-700"
                    >
                      {term}
                    </span>
                  )
                )}
              </div>
            </div>
          </section>
        )}

        {/* STRUCTURED RETRIEVAL */}
        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">

          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Structured Retrieval
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Exact records from structured organizational
                data.
              </p>
            </div>

            <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">
              {structuredResults.length} result
              {structuredResults.length !== 1 ? "s" : ""}
            </span>
          </div>

          {structuredResults.length === 0 ? (
            <div className="rounded-xl bg-slate-50 p-6 text-center text-slate-500">
              No structured results.
            </div>
          ) : (
            <div className="space-y-4">

              {structuredResults.map((result) => (
                <div
                  key={result.id}
                  className="rounded-xl border border-slate-200 p-5"
                >
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">

                    <div>
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                        {result.record_type}
                      </span>

                      <p className="mt-2 text-sm text-slate-500">
                        Source:{" "}
                        <span className="font-medium text-slate-700">
                          {result.source.filename || "Unknown"}
                        </span>
                      </p>
                    </div>

                    <div className="text-sm font-semibold text-green-600">
                      Match: {result.match_score}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="px-3 py-2 font-semibold text-slate-600">
                            Field
                          </th>

                          <th className="px-3 py-2 font-semibold text-slate-600">
                            Value
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {Object.entries(
                          result.record_data
                        ).map(([key, value]) => (
                          <tr
                            key={key}
                            className="border-b border-slate-100 last:border-0"
                          >
                            <td className="px-3 py-2 font-medium text-slate-700">
                              {key}
                            </td>

                            <td className="px-3 py-2 text-slate-900">
                              {formatValue(value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 text-xs text-slate-500">
                    Excel row:{" "}
                    {result.row_number || "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* SEMANTIC RETRIEVAL */}
        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">

          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Semantic Retrieval
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Relevant knowledge chunks found using vector
                similarity.
              </p>
            </div>

            <span className="rounded-full bg-purple-100 px-3 py-1 text-sm font-semibold text-purple-700">
              {semanticResults.length} result
              {semanticResults.length !== 1 ? "s" : ""}
            </span>
          </div>

          {semanticResults.length === 0 ? (
            <div className="rounded-xl bg-slate-50 p-6 text-center text-slate-500">
              No semantic results.
            </div>
          ) : (
            <div className="space-y-4">

              {semanticResults.map((result) => (
                <div
                  key={result.id}
                  className="rounded-xl border border-slate-200 p-5"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">

                    <div>
                      <p className="font-semibold text-slate-900">
                        {result.filename}
                      </p>

                      <p className="text-xs text-slate-500">
                        Chunk {result.chunk_index}
                        {result.page_number
                          ? ` • Page ${result.page_number}`
                          : ""}
                      </p>
                    </div>

                    <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-700">
                      {(
                        result.similarity * 100
                      ).toFixed(1)}
                      %
                    </span>
                  </div>

                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {result.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}