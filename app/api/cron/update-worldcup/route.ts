import { NextRequest, NextResponse } from "next/server";

import { getPredictionsForMatches } from "@/lib/predictions";
import { getDashboardSnapshot } from "@/lib/providers/combinedProvider";
import { getFeaturedMatches } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (cronSecret && authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await getDashboardSnapshot(true);
  const liveMatches = snapshot.matches.filter((match) => match.status === "live" || match.status === "halftime");
  const upcomingWindow = snapshot.matches.filter((match) => {
    const kickoffTime = new Date(match.kickoff).getTime();
    const now = Date.now();
    return match.status === "upcoming" && kickoffTime - now <= 6 * 60 * 60_000 && kickoffTime >= now;
  });

  const warmTargets = [...liveMatches, ...upcomingWindow];
  const uniqueTargetIds = new Set<string>();
  const targets = warmTargets.filter((match) => {
    if (uniqueTargetIds.has(match.id)) {
      return false;
    }

    uniqueTargetIds.add(match.id);
    return true;
  });

  const reducedTargets = targets.length > 0 ? targets : getFeaturedMatches(snapshot.matches).slice(0, 3);
  const knockoutTargets = snapshot.knockout.filter(
    (match) => !match.homeTeam.name.includes("Winner") && !match.awayTeam.name.includes("Winner"),
  );

  const predictions = await getPredictionsForMatches([
    ...reducedTargets,
    ...knockoutTargets.slice(0, 4),
  ]);

  return NextResponse.json({
    ok: true,
    warmedMatches: reducedTargets.length,
    warmedKnockoutMatches: Math.min(knockoutTargets.length, 4),
    predictionsGenerated: predictions.length,
    source: snapshot.source,
    generatedAt: snapshot.generatedAt,
  });
}

