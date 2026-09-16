export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 text-center">
        <div className="mb-6 rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-300">
          Organizational AI Memory
        </div>

        <h1 className="max-w-4xl text-5xl font-bold tracking-tight md:text-7xl">
          Your Organization&apos;s
          <span className="block text-slate-400">
            AI Memory
          </span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-400">
          OrgBrain captures, organizes, retrieves and verifies your
          organization&apos;s knowledge, decisions, procedures and history.
        </p>

        <div className="mt-10 flex gap-4">
          <a
            href="/auth"
            className="rounded-lg bg-white px-6 py-3 font-semibold text-slate-950 transition hover:bg-slate-200"
          >
            Get Started
          </a>

          <a
            href="/auth"
            className="rounded-lg border border-slate-700 px-6 py-3 font-semibold text-white transition hover:bg-slate-900"
          >
            Sign In
          </a>
        </div>

        <div className="mt-16 grid w-full max-w-4xl gap-4 md:grid-cols-3">
          <Feature
            title="Remember"
            description="Capture organizational knowledge and institutional memory."
          />

          <Feature
            title="Retrieve"
            description="Find relevant knowledge using semantic organizational search."
          />

          <Feature
            title="Verify"
            description="Get evidence-backed answers instead of unsupported guesses."
          />
        </div>
      </section>
    </main>
  );
}

function Feature({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-left">
      <h2 className="text-lg font-semibold">{title}</h2>

      <p className="mt-2 text-sm leading-6 text-slate-400">
        {description}
      </p>
    </div>
  );
}