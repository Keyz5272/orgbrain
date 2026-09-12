"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Document = {
  id: string;
  filename: string;
  document_type: string | null;
  department: string | null;
  status: string;
  embedding_status: string;
  uploaded_at: string;
};

const DOCUMENT_TYPES = [
  "Policy",
  "Procedure",
  "Manual",
  "Report",
  "Contract",
  "Meeting Minutes",
  "Project Document",
  "Financial Document",
  "HR Document",
  "Other",
];

export default function KnowledgePage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload state
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("Other");
  const [department, setDepartment] = useState("");

  // Documents
  const [documents, setDocuments] = useState<Document[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  // Loading state
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Messages
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Search and filters
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");

  useEffect(() => {
    initialize();
  }, []);

  // --------------------------------------------------
  // INITIALIZE
  // --------------------------------------------------

  async function initialize() {
    setLoading(true);
    setError("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;

      if (!user) {
        window.location.href = "/auth";
        return;
      }

      const { data: profile, error: profileError } =
        await supabase
          .from("users")
          .select("organization_id")
          .eq("id", user.id)
          .single();

      if (profileError) throw profileError;

      setOrganizationId(profile.organization_id);

      await loadDocuments(profile.organization_id);
    } catch (err: any) {
      console.error(err);

      setError(
        err.message || "Unable to load knowledge."
      );
    } finally {
      setLoading(false);
    }
  }

  // --------------------------------------------------
  // LOAD DOCUMENTS
  // --------------------------------------------------

  async function loadDocuments(orgId: string) {
    const { data, error } = await supabase
      .from("documents")
      .select(
        "id, filename, document_type, department, status, embedding_status, uploaded_at"
      )
      .eq("organization_id", orgId)
      .order("uploaded_at", {
        ascending: false,
      });

    if (error) throw error;

    setDocuments(data || []);
  }

  // --------------------------------------------------
  // PROCESS DOCUMENT
  // --------------------------------------------------

  async function handleProcess(document: Document) {
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        "/api/knowledge/process",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            documentId: document.id,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || "Processing failed."
        );
      }

      setMessage(
        `${document.filename} processed successfully. ${result.chunksCreated} chunks created.`
      );

      if (organizationId) {
        await loadDocuments(organizationId);
      }
    } catch (err: any) {
      console.error(err);

      setError(
        err.message || "Unable to process document."
      );

      if (organizationId) {
        await loadDocuments(organizationId);
      }
    }
  }

  // --------------------------------------------------
  // EMBED DOCUMENT
  // --------------------------------------------------

  async function handleEmbed(document: Document) {
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        "/api/knowledge/embed",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            documentId: document.id,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            "Embedding generation failed."
        );
      }

      setMessage(
        `${document.filename} indexed successfully. ${result.chunksEmbedded} chunks embedded.`
      );

      // Refresh so UI immediately shows Indexed
      if (organizationId) {
        await loadDocuments(organizationId);
      }
    } catch (err: any) {
      console.error(err);

      setError(
        err.message ||
          "Unable to generate embeddings."
      );

      if (organizationId) {
        await loadDocuments(organizationId);
      }
    }
  }

  // --------------------------------------------------
  // FILE SELECTION
  // --------------------------------------------------

  function handleFileChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const selectedFile =
      event.target.files?.[0];

    if (!selectedFile) return;

    setError("");
    setMessage("");

    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
      "text/csv",
    ];

    if (!allowedTypes.includes(selectedFile.type)) {
      setFile(null);

      setError(
        "Unsupported file type. Please upload PDF, Word, Excel, CSV or TXT files."
      );

      return;
    }

    // 20 MB application-level limit
    if (
      selectedFile.size >
      20 * 1024 * 1024
    ) {
      setFile(null);

      setError(
        "File is too large. Maximum allowed size is 20 MB."
      );

      return;
    }

    setFile(selectedFile);
  }

  // --------------------------------------------------
  // UPLOAD DOCUMENT
  // --------------------------------------------------

  async function handleUpload() {
    if (!file) {
      setError(
        "Please select a document."
      );

      return;
    }

    if (!organizationId) {
      setError(
        "Organization could not be determined."
      );

      return;
    }

    setUploading(true);
    setError("");
    setMessage("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/auth";
        return;
      }

      /*
       * Use a UUID filename to prevent collisions.
       *
       * The organization ID is the first folder segment,
       * which is required by our Storage RLS policy.
       */

      const extension = file.name.includes(".")
        ? file.name.substring(
            file.name.lastIndexOf(".")
          )
        : "";

      const uniqueFilename =
        `${crypto.randomUUID()}${extension}`;

      const storagePath =
        `${organizationId}/${uniqueFilename}`;

      // Upload physical file
      const { error: uploadError } =
        await supabase.storage
          .from("knowledge")
          .upload(
            storagePath,
            file,
            {
              cacheControl: "3600",
              upsert: false,
              contentType:
                file.type ||
                "application/octet-stream",
            }
          );

      if (uploadError) {
        throw uploadError;
      }

      // Create document record
      const { error: documentError } =
        await supabase
          .from("documents")
          .insert({
            organization_id:
              organizationId,
            filename: file.name,
            storage_path:
              storagePath,
            document_type:
              documentType,
            department:
              department.trim() || null,
            uploaded_by: user.id,
            status: "pending",
          });

      /*
       * If database insertion fails after
       * the file upload, remove the orphaned
       * storage object.
       */

      if (documentError) {
        await supabase.storage
          .from("knowledge")
          .remove([storagePath]);

        throw documentError;
      }

      setMessage(
        "Document uploaded successfully."
      );

      // Reset upload form
      setFile(null);
      setDepartment("");
      setDocumentType("Other");

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      await loadDocuments(
        organizationId
      );
    } catch (err: any) {
      console.error(err);

      setError(
        err.message || "Upload failed."
      );
    } finally {
      setUploading(false);
    }
  }

  // --------------------------------------------------
  // DELETE DOCUMENT
  // --------------------------------------------------

  async function handleDelete(
    document: Document
  ) {
    const confirmed =
      window.confirm(
        `Delete "${document.filename}"?`
      );

    if (!confirmed) return;

    setError("");
    setMessage("");

    try {
      // Get storage path
      const { data, error } =
        await supabase
          .from("documents")
          .select("storage_path")
          .eq("id", document.id)
          .single();

      if (error) throw error;

      // Delete physical file
      if (data?.storage_path) {
        const {
          error: storageError,
        } = await supabase.storage
          .from("knowledge")
          .remove([
            data.storage_path,
          ]);

        if (storageError) {
          throw storageError;
        }
      }

      // Delete database record
      const {
        error: deleteError,
      } = await supabase
        .from("documents")
        .delete()
        .eq("id", document.id);

      if (deleteError) {
        throw deleteError;
      }

      setMessage(
        "Document deleted."
      );

      if (organizationId) {
        await loadDocuments(
          organizationId
        );
      }
    } catch (err: any) {
      console.error(err);

      setError(
        err.message ||
          "Unable to delete document."
      );
    }
  }

  // --------------------------------------------------
  // FILTERED DOCUMENTS
  // --------------------------------------------------

  const filteredDocuments =
    useMemo(() => {
      const search =
        searchTerm
          .trim()
          .toLowerCase();

      return documents.filter(
        (document) => {
          // Search
          const matchesSearch =
            !search ||
            document.filename
              .toLowerCase()
              .includes(search) ||
            (
              document.document_type ||
              ""
            )
              .toLowerCase()
              .includes(search) ||
            (
              document.department ||
              ""
            )
              .toLowerCase()
              .includes(search);

          // Status
          let currentStatus =
            document.status;

          if (
            document.status ===
              "processed" &&
            document.embedding_status ===
              "pending"
          ) {
            currentStatus =
              "ready_to_index";
          }

          if (
            document.status ===
              "processed" &&
            document.embedding_status ===
              "indexing"
          ) {
            currentStatus =
              "indexing";
          }

          if (
            document.status ===
              "processed" &&
            document.embedding_status ===
              "indexed"
          ) {
            currentStatus =
              "indexed";
          }

          if (
            document.status ===
              "processed" &&
            document.embedding_status ===
              "failed"
          ) {
            currentStatus =
              "failed";
          }

          const matchesStatus =
            statusFilter ===
              "all" ||
            currentStatus ===
              statusFilter;

          // Document type
          const matchesType =
            typeFilter === "all" ||
            document.document_type ===
              typeFilter;

          // Department
          const matchesDepartment =
            departmentFilter ===
              "all" ||
            document.department ===
              departmentFilter;

          return (
            matchesSearch &&
            matchesStatus &&
            matchesType &&
            matchesDepartment
          );
        }
      );
    }, [
      documents,
      searchTerm,
      statusFilter,
      typeFilter,
      departmentFilter,
    ]);

  // --------------------------------------------------
  // DEPARTMENT OPTIONS
  // --------------------------------------------------

  const departments =
    useMemo(() => {
      const unique =
        documents
          .map(
            (document) =>
              document.department
          )
          .filter(
            (
              department
            ): department is string =>
              Boolean(
                department &&
                  department.trim()
              )
          );

      return Array.from(
        new Set(unique)
      ).sort();
    }, [documents]);

  // --------------------------------------------------
  // COUNTERS
  // --------------------------------------------------

  const totalDocuments =
    documents.length;

  const pendingDocuments =
    documents.filter(
      (document) =>
        document.status ===
        "pending"
    ).length;

  const processingDocuments =
    documents.filter(
      (document) =>
        document.status ===
        "processing"
    ).length;

  const indexedDocuments =
    documents.filter(
      (document) =>
        document.status ===
          "processed" &&
        document.embedding_status ===
          "indexed"
    ).length;

  const failedDocuments =
    documents.filter(
      (document) =>
        document.status ===
          "processed" &&
        document.embedding_status ===
          "failed"
    ).length;

  // --------------------------------------------------
  // CLEAR FILTERS
  // --------------------------------------------------

  function clearFilters() {
    setSearchTerm("");
    setStatusFilter("all");
    setTypeFilter("all");
    setDepartmentFilter("all");
  }

  const filtersActive =
    searchTerm.trim() !== "" ||
    statusFilter !== "all" ||
    typeFilter !== "all" ||
    departmentFilter !== "all";

  // --------------------------------------------------
  // HELPERS
  // --------------------------------------------------

  function formatDate(date: string) {
    return new Date(
      date
    ).toLocaleString();
  }

  function formatFileSize(
    size: number
  ) {
    if (size < 1024) {
      return `${size} B`;
    }

    if (
      size <
      1024 * 1024
    ) {
      return `${(
        size / 1024
      ).toFixed(1)} KB`;
    }

    return `${(
      size /
      (1024 * 1024)
    ).toFixed(1)} MB`;
  }

  // --------------------------------------------------
  // STATUS LABEL
  // --------------------------------------------------

  function getStatusLabel(
    document: Document
  ) {
    if (
      document.status ===
      "pending"
    ) {
      return (
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          Pending
        </span>
      );
    }

    if (
      document.status ===
      "processing"
    ) {
      return (
        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
          Processing
        </span>
      );
    }

    if (
      document.status ===
        "processed" &&
      document.embedding_status ===
        "pending"
    ) {
      return (
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
          Ready to Index
        </span>
      );
    }

    if (
      document.status ===
        "processed" &&
      document.embedding_status ===
        "indexing"
    ) {
      return (
        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
          Indexing
        </span>
      );
    }

    if (
      document.status ===
        "processed" &&
      document.embedding_status ===
        "indexed"
    ) {
      return (
        <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
          Indexed ✓
        </span>
      );
    }

    if (
      document.status ===
        "processed" &&
      document.embedding_status ===
        "failed"
    ) {
      return (
        <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
          Indexing Failed
        </span>
      );
    }

    return (
      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
        {document.status}
      </span>
    );
  }

  // --------------------------------------------------
  // LOADING
  // --------------------------------------------------

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        Loading Knowledge...
      </main>
    );
  }

  // --------------------------------------------------
  // PAGE
  // --------------------------------------------------

  return (
    <main className="min-h-screen bg-slate-100">

      {/* HEADER */}
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">

          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Knowledge
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Upload and manage your organization's knowledge.
            </p>
          </div>

          <button
            onClick={() =>
              (window.location.href =
                "/dashboard")
            }
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Dashboard
          </button>

        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-8">

        {/* UPLOAD CARD */}
        <div className="rounded-2xl border bg-white p-6 shadow-sm">

          <div className="mb-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Upload Knowledge
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Add documents that OrgBrain will eventually learn from.
            </p>
          </div>

          {/* DROP ZONE */}
          <div
            onClick={() =>
              fileInputRef.current?.click()
            }
            className="cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-10 text-center transition hover:border-slate-500 hover:bg-slate-100"
          >

            <div className="text-4xl">
              📄
            </div>

            <h3 className="mt-3 font-medium text-slate-900">
              {file
                ? file.name
                : "Click to select a document"}
            </h3>

            <p className="mt-2 text-sm text-slate-500">
              PDF, Word, Excel, CSV or TXT • Maximum 20 MB
            </p>

            {file && (
              <p className="mt-2 text-xs text-slate-400">
                {formatFileSize(
                  file.size
                )}
              </p>
            )}

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
              onChange={
                handleFileChange
              }
            />

          </div>

          {/* METADATA */}
          <div className="mt-6 grid gap-5 md:grid-cols-2">

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Document Type
              </label>

              <select
                value={
                  documentType
                }
                onChange={(e) =>
                  setDocumentType(
                    e.target.value
                  )
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-slate-500"
              >
                {DOCUMENT_TYPES.map(
                  (type) => (
                    <option
                      key={type}
                    >
                      {type}
                    </option>
                  )
                )}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Department
              </label>

              <input
                value={
                  department
                }
                onChange={(e) =>
                  setDepartment(
                    e.target.value
                  )
                }
                placeholder="e.g. Finance, HR, Operations"
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
              />
            </div>

          </div>

          {/* MESSAGES */}
          {error && (
            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {message && (
            <div className="mt-5 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {message}
            </div>
          )}

          {/* UPLOAD BUTTON */}
          <div className="mt-6 flex justify-end">

            <button
              onClick={
                handleUpload
              }
              disabled={
                !file ||
                uploading
              }
              className="rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading
                ? "Uploading..."
                : "Upload Document"}
            </button>

          </div>

        </div>

        {/* DOCUMENTS CARD */}
        <div className="mt-8 rounded-2xl border bg-white shadow-sm">

          {/* DOCUMENT HEADER */}
          <div className="border-b px-6 py-5">

            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Organizational Documents
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Documents uploaded to your organization's private knowledge base.
                </p>
              </div>

              <div className="text-sm text-slate-500">
                Showing{" "}
                <span className="font-semibold text-slate-900">
                  {filteredDocuments.length}
                </span>{" "}
                of{" "}
                <span className="font-semibold text-slate-900">
                  {documents.length}
                </span>
              </div>

            </div>

          </div>

          {/* COUNTERS */}
          <div className="grid grid-cols-2 border-b sm:grid-cols-5">

            <div className="border-b px-6 py-5 sm:border-b-0 sm:border-r">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Total
              </p>

              <p className="mt-1 text-2xl font-bold text-slate-900">
                {totalDocuments}
              </p>
            </div>

            <div className="border-b px-6 py-5 sm:border-b-0 sm:border-r">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Pending
              </p>

              <p className="mt-1 text-2xl font-bold text-slate-600">
                {pendingDocuments}
              </p>
            </div>

            <div className="border-b px-6 py-5 sm:border-b-0 sm:border-r">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Processing
              </p>

              <p className="mt-1 text-2xl font-bold text-blue-600">
                {processingDocuments}
              </p>
            </div>

            <div className="border-b px-6 py-5 sm:border-b-0 sm:border-r">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Indexed
              </p>

              <p className="mt-1 text-2xl font-bold text-green-600">
                {indexedDocuments}
              </p>
            </div>

            <div className="px-6 py-5">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Failed
              </p>

              <p className="mt-1 text-2xl font-bold text-red-600">
                {failedDocuments}
              </p>
            </div>

          </div>

          {/* SEARCH + FILTERS */}
          <div className="border-b bg-slate-50 px-6 py-5">

            <div className="grid gap-4 lg:grid-cols-12">

              {/* SEARCH */}
              <div className="lg:col-span-5">

                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Search
                </label>

                <div className="relative">

                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                    🔍
                  </span>

                  <input
                    type="text"
                    value={
                      searchTerm
                    }
                    onChange={(e) =>
                      setSearchTerm(
                        e.target.value
                      )
                    }
                    placeholder="Search filename, type or department..."
                    className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />

                </div>

              </div>

              {/* STATUS */}
              <div className="lg:col-span-2">

                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Status
                </label>

                <select
                  value={
                    statusFilter
                  }
                  onChange={(e) =>
                    setStatusFilter(
                      e.target.value
                    )
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-blue-500"
                >
                  <option value="all">
                    All Statuses
                  </option>

                  <option value="pending">
                    Pending
                  </option>

                  <option value="processing">
                    Processing
                  </option>

                  <option value="ready_to_index">
                    Ready to Index
                  </option>

                  <option value="indexing">
                    Indexing
                  </option>

                  <option value="indexed">
                    Indexed
                  </option>

                  <option value="failed">
                    Failed
                  </option>
                </select>

              </div>

              {/* TYPE */}
              <div className="lg:col-span-2">

                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Type
                </label>

                <select
                  value={
                    typeFilter
                  }
                  onChange={(e) =>
                    setTypeFilter(
                      e.target.value
                    )
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-blue-500"
                >
                  <option value="all">
                    All Types
                  </option>

                  {DOCUMENT_TYPES.map(
                    (type) => (
                      <option
                        key={type}
                        value={type}
                      >
                        {type}
                      </option>
                    )
                  )}
                </select>

              </div>

              {/* DEPARTMENT */}
              <div className="lg:col-span-2">

                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Department
                </label>

                <select
                  value={
                    departmentFilter
                  }
                  onChange={(e) =>
                    setDepartmentFilter(
                      e.target.value
                    )
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-blue-500"
                >
                  <option value="all">
                    All Departments
                  </option>

                  {departments.map(
                    (dept) => (
                      <option
                        key={dept}
                        value={dept}
                      >
                        {dept}
                      </option>
                    )
                  )}
                </select>

              </div>

            </div>

            {/* CLEAR FILTERS */}
            {filtersActive && (
              <div className="mt-4 flex items-center justify-between">

                <p className="text-xs text-slate-500">
                  Filters are active.
                </p>

                <button
                  onClick={
                    clearFilters
                  }
                  className="text-sm font-medium text-blue-600 hover:text-blue-800"
                >
                  Clear filters
                </button>

              </div>
            )}

          </div>

          {/* DOCUMENT TABLE */}
          {documents.length === 0 ? (

            <div className="px-6 py-12 text-center">

              <div className="text-4xl">
                📂
              </div>

              <p className="mt-3 text-slate-500">
                No documents uploaded yet.
              </p>

            </div>

          ) : filteredDocuments.length === 0 ? (

            <div className="px-6 py-12 text-center">

              <div className="text-4xl">
                🔎
              </div>

              <p className="mt-3 font-medium text-slate-700">
                No documents match your search.
              </p>

              <p className="mt-1 text-sm text-slate-500">
                Try changing your search or filters.
              </p>

              <button
                onClick={
                  clearFilters
                }
                className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Clear Filters
              </button>

            </div>

          ) : (

            <div className="overflow-x-auto">

              <table className="w-full text-left text-sm">

                <thead className="border-b bg-white">

                  <tr>

                    <th className="px-6 py-4 font-semibold text-slate-700">
                      Document
                    </th>

                    <th className="px-6 py-4 font-semibold text-slate-700">
                      Type
                    </th>

                    <th className="px-6 py-4 font-semibold text-slate-700">
                      Department
                    </th>

                    <th className="px-6 py-4 font-semibold text-slate-700">
                      Status
                    </th>

                    <th className="px-6 py-4 font-semibold text-slate-700">
                      Uploaded
                    </th>

                    <th className="px-6 py-4 text-right font-semibold text-slate-700">
                      Action
                    </th>

                  </tr>

                </thead>

                <tbody className="divide-y">

                  {filteredDocuments.map(
                    (document) => (

                      <tr
                        key={
                          document.id
                        }
                        className="transition hover:bg-slate-50"
                      >

                        {/* DOCUMENT */}
                        <td className="px-6 py-4">

                          <div className="flex items-center gap-3">

                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg">
                              📄
                            </div>

                            <div className="min-w-0">

                              <p className="truncate font-medium text-slate-900">
                                {
                                  document.filename
                                }
                              </p>

                            </div>

                          </div>

                        </td>

                        {/* TYPE */}
                        <td className="px-6 py-4 text-slate-500">
                          {
                            document.document_type ||
                            "—"
                          }
                        </td>

                        {/* DEPARTMENT */}
                        <td className="px-6 py-4 text-slate-500">
                          {
                            document.department ||
                            "—"
                          }
                        </td>

                        {/* STATUS */}
                        <td className="px-6 py-4">
                          {
                            getStatusLabel(
                              document
                            )
                          }
                        </td>

                        {/* DATE */}
                        <td className="whitespace-nowrap px-6 py-4 text-slate-500">
                          {
                            formatDate(
                              document.uploaded_at
                            )
                          }
                        </td>

                        {/* ACTIONS */}
                        <td className="px-6 py-4 text-right">

                          <div className="flex justify-end gap-4">

                            {/* PROCESS */}
                            {document.status ===
                              "pending" && (
                              <button
                                onClick={() =>
                                  handleProcess(
                                    document
                                  )
                                }
                                className="text-sm font-medium text-blue-600 hover:text-blue-800"
                              >
                                Process
                              </button>
                            )}

                            {/* EMBED */}
                            {document.status ===
                                "processed" &&
                              document.embedding_status !==
                                "indexed" && (
                                <button
                                  onClick={() =>
                                    handleEmbed(
                                      document
                                    )
                                  }
                                  className="text-sm font-medium text-purple-600 hover:text-purple-800"
                                >
                                  {document.embedding_status ===
                                  "indexing"
                                    ? "Indexing..."
                                    : document.embedding_status ===
                                        "failed"
                                      ? "Retry"
                                      : "Embed"}
                                </button>
                              )}

                            {/* INDEXED */}
                            {document.embedding_status ===
                              "indexed" && (
                              <span className="text-sm font-medium text-green-600">
                                Indexed ✓
                              </span>
                            )}

                            {/* DELETE */}
                            <button
                              onClick={() =>
                                handleDelete(
                                  document
                                )
                              }
                              className="text-sm font-medium text-red-600 hover:text-red-800"
                            >
                              Delete
                            </button>

                          </div>

                        </td>

                      </tr>

                    )
                  )}

                </tbody>

              </table>

            </div>

          )}

        </div>

      </section>

    </main>
  );
}