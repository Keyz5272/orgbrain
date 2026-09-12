"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

export default function AuthPage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("signin");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const isSignup = mode === "signup";

  function switchMode(newMode: Mode) {
    setMode(newMode);
    setMessage("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setLoading(true);
    setMessage("");

    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            },
          },
        });

        if (error) {
          setMessage(error.message);
          return;
        }

        if (!data.session) {
          setMessage(
            "Account created. Please check your email and confirm your account before signing in."
          );
          return;
        }

        router.push("/onboarding");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          setMessage(error.message);
          return;
        }

        router.push("/dashboard");
      }
    } catch (error) {
      console.error(error);

      setMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 text-white">
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center">
        <div className="w-full">
          {/* Brand */}
          <div className="mb-8 text-center">
            <div className="mb-3 text-3xl font-bold tracking-tight">
              OrgBrain
            </div>

            <p className="text-sm text-slate-400">
              Organizational AI Memory
            </p>
          </div>

          {/* Auth Card */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
            {/* Heading */}
            <div className="mb-7">
              <h1 className="text-2xl font-bold">
                {isSignup ? "Create your account" : "Welcome back"}
              </h1>

              <p className="mt-2 text-sm text-slate-400">
                {isSignup
                  ? "Start building your organization's memory."
                  : "Sign in to access your organization's memory."}
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit}>
              {isSignup && (
                <div className="mb-4">
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Full name
                  </label>

                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your full name"
                    required
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-slate-400"
                  />
                </div>
              )}

              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Email
                </label>

                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-slate-400"
                />
              </div>

              <div className="mb-5">
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Password
                </label>

                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-slate-400"
                />
              </div>

              {!isSignup && (
                <div className="mb-5 text-right">
                  <button
                    type="button"
                    className="text-sm text-slate-400 hover:text-white"
                    onClick={() =>
                      setMessage(
                        "Password recovery will be added next."
                      )
                    }
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-white px-4 py-3 font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? isSignup
                    ? "Creating account..."
                    : "Signing in..."
                  : isSignup
                    ? "Create Account"
                    : "Sign In"}
              </button>
            </form>

            {/* Message */}
            {message && (
              <div className="mt-5 rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-300">
                {message}
              </div>
            )}

            {/* Divider */}
            <div className="my-7 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-800" />

              <span className="text-xs uppercase tracking-wider text-slate-600">
                or
              </span>

              <div className="h-px flex-1 bg-slate-800" />
            </div>

            {/* Mode Switch */}
            <div className="text-center text-sm text-slate-400">
              {isSignup ? (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("signin")}
                    className="font-semibold text-white hover:underline"
                  >
                    Sign In
                  </button>
                </>
              ) : (
                <>
                  New to OrgBrain?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("signup")}
                    className="font-semibold text-white hover:underline"
                  >
                    Create Account
                  </button>
                </>
              )}
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-slate-600">
            Your organization's knowledge belongs to your organization.
          </p>
        </div>
      </div>
    </main>
  );
}