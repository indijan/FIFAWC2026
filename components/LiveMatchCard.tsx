import { FlagTeam } from "@/components/FlagTeam";
import { MatchStatusBadge } from "@/components/MatchStatusBadge";
import { ProbabilityBars } from "@/components/ProbabilityBars";
import { Match, Prediction } from "@/lib/types";
import { formatKickoff, isKnockoutMatch } from "@/lib/utils";

export function LiveMatchCard({
  match,
  prediction,
}: {
  match: Match;
  prediction?: Prediction | null;
}) {
  const hasScore = match.homeScore !== undefined && match.awayScore !== undefined;
  const knockout = isKnockoutMatch(match);

  return (
    <article className="panel-surface panel-grid rounded-3xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-mist">
            {match.group ? `Group ${match.group}` : match.stage}
          </p>
          <h3 className="mt-2 font-display text-2xl text-ink">{match.stage}</h3>
          <p className="mt-1 text-sm text-mist">
            {formatKickoff(match.kickoff)}
            {match.venue ? ` • ${match.venue}` : ""}
          </p>
        </div>
        <MatchStatusBadge status={match.status} minute={match.minute} />
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <FlagTeam team={match.homeTeam} />
        <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-center">
          <div className="font-mono text-3xl font-semibold tracking-tight text-ink">
            {hasScore ? `${match.homeScore} : ${match.awayScore}` : "vs"}
          </div>
          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-mist">
            {match.status === "upcoming" ? "Kickoff pending" : "Match centre"}
          </div>
        </div>
        <div className="md:justify-self-end">
          <FlagTeam team={match.awayTeam} />
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/45 p-4">
        {prediction ? (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-mist">AI model estimate</p>
                <p className="text-sm text-ink">{prediction.reasoningShort}</p>
              </div>
              <div className="text-right text-xs text-mist">
                <div>Confidence: {prediction.confidence}</div>
                <div>{prediction.dataFreshness}</div>
              </div>
            </div>
            <div className="mb-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em] text-mist">
              <span className="rounded-full border border-white/10 px-2.5 py-1">
                Match feed: {match.source ?? "unknown"}
              </span>
              <span className="rounded-full border border-white/10 px-2.5 py-1">
                Estimate mode: {prediction.estimateSource ?? "unknown"}
              </span>
            </div>
            <ProbabilityBars
              prediction={prediction}
              knockout={knockout}
              homeLabel={match.homeTeam.name}
              awayLabel={match.awayTeam.name}
            />
          </>
        ) : (
          <div className="text-sm text-mist">Estimate unavailable.</div>
        )}
      </div>
    </article>
  );
}
