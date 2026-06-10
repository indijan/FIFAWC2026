"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-4">
      <div className="panel-surface w-full max-w-md rounded-[2rem] p-6 text-center md:p-8">
        <p className="text-xs uppercase tracking-[0.24em] text-accent">Error</p>
        <h1 className="mt-3 font-display text-3xl text-ink">Something went wrong</h1>
        <p className="mt-3 text-sm leading-6 text-mist">
          {error.message || "An unexpected error occurred while loading the dashboard."}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-2xl bg-accent px-6 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-110"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
