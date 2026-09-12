"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function DashboardPage() {
  const router = useRouter();

  const [name, setName] = useState("User");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/auth");
        return;
      }

      setName(user.user_metadata?.full_name || "User");
      setLoading(false);
    }

    loadUser();
  }, [router]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/auth");
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        Loading OrgBrain...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            OrgBrain
          </h1>
          <p className="text-sm text-slate-500">
            Organizational AI Memory
          </p>
        </div>

        <button
          onClick={handleLogout}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Sign Out
        </button>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h2 className="text-3xl font-bold text-slate-900">
          Welcome, {name}
        </h2>

        <p className="mt-2 text-slate-500">
          Your organization's memory starts here.
        </p>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <DashboardCard
            title="Knowledge"
            description="Upload and manage organizational knowledge."
          />

          <DashboardCard
            title="Memory"
            description="View structured organizational memories."
          />

          <DashboardCard
            title="Ask AI"
            description="Ask questions about your organization."
          />
        </div>
      </section>
    </main>
  );
}

function DashboardCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900">
        {title}
      </h3>

      <p className="mt-2 text-sm leading-6 text-slate-500">
        {description}
      </p>
    </div>
  );
}