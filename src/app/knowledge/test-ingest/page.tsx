"use client";

import { useState } from "react";

export default function TestIngestPage() {
  const [file, setFile] =
    useState<File | null>(null);

  const [result, setResult] =
    useState<unknown>(null);

  const [loading, setLoading] =
    useState(false);

  async function ingest() {
    if (!file) {
      alert("Select a file first.");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const formData =
        new FormData();

      formData.append(
        "file",
        file
      );

      const response =
        await fetch(
          "/api/knowledge/ingest",
          {
            method: "POST",
            body: formData,
          }
        );

      const data =
        await response.json();

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
      <div className="mx-auto max-w-3xl">

        <h1 className="text-2xl font-bold text-slate-900">
          OrgBrain Universal Ingestion Test
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          This tests the complete ingestion pipeline.
        </p>

        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">


<label className="block text-sm font-medium text-slate-700">
  Select Knowledge File
</label>

          <input
            type="file"
           accept=".xlsx,.xls,.csv,.docx,.pdf,.png,.jpg,.jpeg"
            onChange={(event) =>
              setFile(
                event.target.files?.[0] ??
                  null
              )
            }
            className="block w-full text-sm"
          />

          <p className="mt-2 text-xs text-slate-500">
  Supported for this test: Excel (.xlsx, .xls, .csv),
  Word (.docx), and PDF (.pdf)
</p>

          {file && (
            <p className="mt-4 text-sm text-slate-600">
              Selected:{" "}
              <strong>
                {file.name}
              </strong>
            </p>
          )}

          <button
            type="button"
            onClick={ingest}
            disabled={
              loading ||
              !file
            }
            className="mt-5 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading
              ? "Ingesting..."
              : "Ingest File"}
          </button>
        </div>

        {result !== null && (
          <div className="mt-8">

            <h2 className="mb-3 text-lg font-semibold">
              Ingestion Result
            </h2>

            <pre className="overflow-auto rounded-xl bg-slate-950 p-6 text-xs leading-6 text-slate-100">
              {JSON.stringify(
                result,
                null,
                2
              )}
            </pre>

          </div>
        )}

      </div>
    </main>
  );
}