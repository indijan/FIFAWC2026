import { MatchStatus } from "@/lib/types";

const STATUS_STYLES: Record<MatchStatus, string> = {
  live: "bg-emerald-400/15 text-emerald-200 ring-emerald-400/20",
  halftime: "bg-amber-400/15 text-amber-100 ring-amber-300/25",
  upcoming: "bg-sky-400/15 text-sky-100 ring-sky-300/25",
  finished: "bg-white/10 text-slate-200 ring-white/10",
};

const STATUS_LABELS: Record<MatchStatus, string> = {
  live: "LIVE",
  halftime: "HALFTIME",
  upcoming: "UPCOMING",
  finished: "FINISHED",
};

export function MatchStatusBadge({
  status,
  minute,
}: {
  status: MatchStatus;
  minute?: number;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.18em] ring-1 ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
      {(status === "live" || status === "halftime") && minute ? <span>{minute}'</span> : null}
    </span>
  );
}

