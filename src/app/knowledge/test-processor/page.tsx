"use client";

import { useState } from "react";

type ProcessorResult = {
  success?: boolean;
  processor?: string;
  sourceType?: string;
  filename?: string;
  contentCount?: number;
  memoryCount?: number;
  metadata?: Record<string, unknown>;
  contents?: unknown[];
  memories?: unknown[];
  error?: string | null;
};

export default function TestProcessorPage() {
  const [file, setFile] = useState<File | null>(null);

  const [result, setResult] =
    useState<ProcessorResult | null>(null);

  const [loading, setLoading] =
    useState(false);

  async function testProcessor() {
    if (!file) {
      alert("Please select a spreadsheet.");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const formData = new FormData();

      formData.append("file", file);

      const response = await fetch(
        "/api/knowledge/test-processor",
        {
          method: "POST",
          body: formData,
        }
      );

      const data =
        (await response.json()) as ProcessorResult;

      setResult(data);
    } catch (error) {
      setResult({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Request failed.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-6xl">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            OrgBrain Processor Test
          </h1>

          <p className="mt-2 text-sm text-slate-600">
            Test the universal spreadsheet processor
            independently.
          </p>
        </div>

        {/* Upload Card */}
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">

          <label className="block text-sm font-medium text-slate-700">
            Select Spreadsheet
          </label>

          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(event) => {
              setFile(
                event.target.files?.[0] ?? null
              );

              setResult(null);
            }}
            className="mt-3 block w-full cursor-pointer rounded-lg border border-slate-300 bg-white p-2 text-sm"
          />

          {/* Selected File */}
          {file !== null && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <p className="text-sm text-slate-600">
                Selected file:
              </p>

              <p className="mt-1 text-sm font-semibold text-slate-900">
                {file.name}
              </p>

              <p className="mt-1 text-xs text-slate-500">
                {(file.size / 1024).toFixed(2)} KB
              </p>
            </div>
          )}

          {/* Test Button */}
          <button
            type="button"
            onClick={testProcessor}
            disabled={
              loading ||
              file === null
            }
            className="mt-5 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? "Processing..."
              : "Test Processor"}
          </button>
        </div>

        {/* Result */}
        {result !== null && (
          <div className="mt-8">

            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Processor Result
            </h2>

            {/* Status */}
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">
                  Status
                </p>

                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {result.success
                    ? "Success"
                    : "Failed"}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">
                  Processor
                </p>

                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {result.processor ?? "—"}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">
                  Source Type
                </p>

                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {result.sourceType ?? "—"}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">
                  Content Items
                </p>

                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {result.contentCount ?? 0}
                </p>
              </div>

            </div>

            {/* Error */}
            {result.error && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-semibold text-red-700">
                  Processor Error
                </p>

                <p className="mt-1 text-sm text-red-600">
                  {result.error}
                </p>
              </div>
            )}

            {/* Raw Result */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">

              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  Raw Processor Output
                </h3>
              </div>

              <pre className="max-h-[700px] overflow-auto bg-slate-950 p-6 text-xs leading-6 text-slate-100">
                {JSON.stringify(
                  result,
                  null,
                  2
                )}
              </pre>

            </div>

          </div>
        )}

      </div>
    </main>
  );
}