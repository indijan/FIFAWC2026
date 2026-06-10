"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";

import { AccordionSection } from "@/components/AccordionSection";
import { Disclaimer } from "@/components/Disclaimer";
import { GroupTable } from "@/components/GroupTable";
import { KnockoutBracket } from "@/components/KnockoutBracket";
import { LiveMatchCard } from "@/components/LiveMatchCard";
import { DashboardSnapshot, GroupStanding, Match, Prediction } from "@/lib/types";
import { getFeaturedMatches } from "@/lib/utils";

type MatchesResponse = {
  matches: Match[];
  generatedAt: string;
  freshnessLabel: string;
  source: string;
};

type StandingsResponse = {
  standings: GroupStanding[];
};

type KnockoutResponse = {
  matches: Match[];
};

export function DashboardShell({
  initialSnapshot,
  initialPredictions,
}: {
  initialSnapshot: DashboardSnapshot;
  initialPredictions: Record<string, Prediction | null>;
}) {
  const [matches, setMatches] = useState(initialSnapshot.matches);
  const [standings, setStandings] = useState(initialSnapshot.standings);
  const [knockout, setKnockout] = useState(initialSnapshot.knockout);
  const [predictions, setPredictions] = useState(initialPredictions);
  const [freshnessLabel, setFreshnessLabel] = useState(initialSnapshot.freshnessLabel);
  const [source, setSource] = useState(initialSnapshot.source);

  const featuredMatches = useMemo(() => getFeaturedMatches(matches), [matches]);
  const connectedSources = useMemo(
    () =>
      Array.from(
        new Set(
          source
            .split("->")
            .map((item) => item.trim())
            .filter((item) => Boolean(item) && item !== "no-provider-data"),
        ),
      ),
    [source],
  );
  const hasProviderData = connectedSources.length > 0;

  const refreshMatches = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/matches", { cache: "no-store" });
      const data = (await response.json()) as MatchesResponse;
      setMatches(data.matches);
      setFreshnessLabel(data.freshnessLabel);
      setSource(data.source);
    } catch (error) {
      console.error("Match polling failed:", error);
    }
  });

  const refreshStandings = useEffectEvent(async () => {
    try {
      const [standingsResponse, knockoutResponse] = await Promise.all([
        fetch("/api/standings", { cache: "no-store" }),
        fetch("/api/knockout", { cache: "no-store" }),
      ]);
      const standingsData = (await standingsResponse.json()) as StandingsResponse;
      const knockoutData = (await knockoutResponse.json()) as KnockoutResponse;
      setStandings(standingsData.standings);
      setKnockout(knockoutData.matches);
    } catch (error) {
      console.error("Standings polling failed:", error);
    }
  });

  const refreshPredictions = useEffectEvent(async () => {
    const liveTargets = matches.filter((match) => match.status === "live" || match.status === "halftime");

    if (liveTargets.length === 0) {
      return;
    }

    try {
      const payloads = await Promise.all(
        liveTargets.map(async (match) => {
          const response = await fetch(`/api/predict?matchId=${encodeURIComponent(match.id)}`, {
            cache: "no-store",
          });
          const prediction = (await response.json()) as Prediction;
          return [match.id, prediction] as const;
        }),
      );

      setPredictions((current) => ({
        ...current,
        ...Object.fromEntries(payloads),
      }));
    } catch (error) {
      console.error("Prediction polling failed:", error);
    }
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshMatches();
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [refreshMatches]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshStandings();
    }, 120_000);

    return () => window.clearInterval(timer);
  }, [refreshStandings]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshPredictions();
    }, 120_000);

    return () => window.clearInterval(timer);
  }, [refreshPredictions]);

  return (
    <>
      <main className="mx-auto min-h-screen w-full max-w-7xl px-4 pb-28 pt-6 md:px-6 md:pt-10">
        <header className="mb-8 rounded-[2rem] border border-white/10 bg-slate-950/60 p-6 shadow-panel backdrop-blur">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-accent">World Cup match centre</p>
              <h1 className="mt-3 max-w-3xl font-display text-4xl text-ink md:text-5xl">
                Championship Match Win Calculator
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-mist md:text-base">
                Live match tracking, real-time group movement, and informational outcome probability estimates.
              </p>
            </div>

            <div className="flex flex-col items-start gap-3 lg:items-end">
              <div className="text-sm text-mist">
                <div>{freshnessLabel}</div>
                <div className="max-w-xs truncate text-xs uppercase tracking-[0.18em]">{source}</div>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em] text-mist lg:justify-end">
                <span className="rounded-full border border-white/10 px-3 py-1">
                  Data mode: {hasProviderData ? "external feed" : "no provider data"}
                </span>
                {connectedSources.map((sourceName) => (
                  <span key={sourceName} className="rounded-full border border-white/10 px-3 py-1">
                    {sourceName}
                  </span>
                ))}
              </div>
              <form action="/api/auth/logout" method="post">
                <button
                  type="submit"
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-ink transition hover:border-accent/50 hover:bg-white/5"
                >
                  Lock dashboard
                </button>
              </form>
            </div>
          </div>
        </header>

        <div className="space-y-5">
          <AccordionSection
            title="Live Broadcasting / Match Centre"
            subtitle="Always-on live and upcoming match coverage."
            defaultOpen
            forcedOpen
          >
            {featuredMatches.length > 0 ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {featuredMatches.map((match) => (
                  <LiveMatchCard key={match.id} match={match} prediction={predictions[match.id]} />
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-mist">
                No live or upcoming match data is currently available from the connected providers.
              </div>
            )}
          </AccordionSection>

          <AccordionSection
            title="Real-time Group Tables"
            subtitle="Group standings react to current score states and completed results."
          >
            {standings.length > 0 ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {standings.map((standing) => (
                  <GroupTable key={standing.group} standing={standing} />
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-mist">
                No group table data is currently available from the connected providers.
              </div>
            )}
          </AccordionSection>

          <AccordionSection
            title="Knockout Stage"
            subtitle="Placeholder bracket structure fills automatically as pairings become known."
          >
            {knockout.length > 0 ? (
              <KnockoutBracket matches={knockout} predictions={predictions} />
            ) : (
              <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-mist">
                No knockout bracket data is currently available from the connected providers.
              </div>
            )}
          </AccordionSection>
        </div>
      </main>
      <Disclaimer />
    </>
  );
}
