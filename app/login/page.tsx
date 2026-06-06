import { isPasswordConfigured } from "@/lib/auth";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const redirect = typeof resolvedSearchParams.redirect === "string" ? resolvedSearchParams.redirect : "/";
  const hasError = resolvedSearchParams.error === "1";
  const missingPassword = resolvedSearchParams.missingPassword === "1";
  const passwordReady = isPasswordConfigured();

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="panel-surface panel-grid w-full max-w-md rounded-[2rem] p-6 md:p-8">
        <p className="text-xs uppercase tracking-[0.24em] text-accent">Protected dashboard</p>
        <h1 className="mt-3 font-display text-4xl text-ink">Enter password</h1>
        <p className="mt-3 text-sm leading-6 text-mist">
          The full World Cup dashboard is hidden behind a password gate before any page or API can be reached.
        </p>

        {!passwordReady || missingPassword ? (
          <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
            Set <code className="font-mono">SITE_PASSWORD</code> in your environment before using the gate.
          </div>
        ) : null}

        {hasError ? (
          <div className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">
            Incorrect password.
          </div>
        ) : null}

        <form action="/api/auth/login" method="post" className="mt-6 space-y-4">
          <input type="hidden" name="redirect" value={redirect} />
          <label className="block">
            <span className="mb-2 block text-sm text-mist">Password</span>
            <input
              type="password"
              name="password"
              autoFocus
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-ink outline-none transition focus:border-accent/60"
              placeholder="Enter dashboard password"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-110"
          >
            Unlock site
          </button>
        </form>
      </div>
    </main>
  );
}

