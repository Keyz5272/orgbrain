"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function OnboardingPage() {
  const router = useRouter();

  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [country, setCountry] = useState("");
  const [department, setDepartment] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();

  setLoading(true);
  setMessage("");

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setMessage("You must be signed in.");
      return;
    }

    const { data: organizationId, error } = await supabase.rpc(
      "create_organization",
      {
        p_name: companyName,
        p_industry: industry,
        p_country: country,
        p_department: department,
        p_full_name:
          user.user_metadata?.full_name || "Organization Admin",
      }
    );

    if (error) {
      throw error;
    }

    console.log("Organization created:", organizationId);

    router.push("/dashboard");
  } catch (error) {
    console.error(error);

    setMessage(
      error instanceof Error
        ? error.message
        : "Something went wrong while creating the organization."
    );
  } finally {
    setLoading(false);
  }
}

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-lg"
      >
        <h1 className="text-3xl font-bold text-slate-900">
          Create your organization
        </h1>

        <p className="mt-2 mb-8 text-sm text-slate-500">
          This will become the foundation of your organizational memory.
        </p>

        <label className="mb-2 block text-sm font-medium">
          Organization name
        </label>

        <input
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="ABC Company Ltd"
          required
          className="mb-5 w-full rounded-lg border p-3"
        />

        <label className="mb-2 block text-sm font-medium">
          Industry
        </label>

        <input
          type="text"
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          placeholder="Technology"
          required
          className="mb-5 w-full rounded-lg border p-3"
        />

        <label className="mb-2 block text-sm font-medium">
          Country
        </label>

        <input
          type="text"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          placeholder="Ghana"
          required
          className="mb-5 w-full rounded-lg border p-3"
        />

        <label className="mb-2 block text-sm font-medium">
          Your department
        </label>

        <input
          type="text"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          placeholder="Management"
          className="mb-6 w-full rounded-lg border p-3"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-slate-900 p-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "Creating organization..." : "Create Organization"}
        </button>

        {message && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
            {message}
          </p>
        )}
      </form>
    </main>
  );
}