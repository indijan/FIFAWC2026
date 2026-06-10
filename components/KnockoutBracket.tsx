import { useMemo } from "react";

import { FlagTeam } from "@/components/FlagTeam";
import { MatchStatusBadge } from "@/components/MatchStatusBadge";
import { ProbabilityBars } from "@/components/ProbabilityBars";
import { Match, Prediction } from "@/lib/types";
import { formatKickoff } from "@/lib/utils";

const STAGE_ORDER = [
  "Round of 32",
  "Round of 16",
  "Quarterfinal",
  "Semifinal",
  "Third-place Match",
  "Final",
] as const;

export function KnockoutBracket({
  matches,
  predictions,
}: {
  matches: Match[];
  predictions: Record<string, Prediction | null>;
}) {
  const groupedByStage = useMemo(
    () =>
      STAGE_ORDER.map((stage) => ({
        stage,
        stageMatches: matches.filter((match) => match.stage === stage),
      })),
    [matches],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {groupedByStage.map(({ stage, stageMatches }) => {

        if (stageMatches.length === 0) {
          return null;
        }

        return (
          <section key={stage} className="panel-surface rounded-3xl p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="font-display text-2xl text-ink">{stage}</h3>
              <span className="text-xs uppercase tracking-[0.18em] text-mist">
                {stageMatches.length} ties
              </span>
            </div>
            <div className="space-y-3">
              {stageMatches.map((match) => (
                <article key={match.id} className="rounded-2xl border border-white/8 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm text-mist">{formatKickoff(match.kickoff)}</div>
                    <MatchStatusBadge status={match.status} minute={match.minute} />
                  </div>
                  <div className="mt-3 space-y-2">
                    <FlagTeam team={match.homeTeam} compact />
                    <FlagTeam team={match.awayTeam} compact />
                  </div>
                  <div className="mt-3 text-xs text-mist">
                    {match.homeScore !== undefined && match.awayScore !== undefined
                      ? `Score: ${match.homeScore}-${match.awayScore}`
                      : "Placeholder pairing until qualification is confirmed."}
                  </div>
                  {predictions[match.id] ? (
                    <div className="mt-4 border-t border-white/10 pt-4">
                      <ProbabilityBars
                        prediction={predictions[match.id] as Prediction}
                        knockout
                        homeLabel={match.homeTeam.name}
                        awayLabel={match.awayTeam.name}
                      />
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
