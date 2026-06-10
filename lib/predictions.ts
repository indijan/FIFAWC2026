import { Match, Prediction } from "@/lib/types";
import { getTeamSeedByCode, getTeamSeedByNameOrCode, rankingToElo } from "@/lib/team-metadata";
import { getCachedValue, setCachedValue } from "@/lib/server-cache";
import { clamp, isKnockoutMatch, normalizePercentages, safeJsonParse } from "@/lib/utils";

const PREDICTION_TTL_MS = 2 * 60_000;
const DISCLAIMER = "Informational AI estimate only. Not betting or financial advice.";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const OPENAI_SYSTEM_PROMPT = `You are a world-class football match analyst and probability estimator. Your task is to estimate match outcome probabilities with maximum accuracy.

RULES:
- Return calibrated percentages that sum to exactly 100 for home/draw/away.
- For knockout matches, also estimate regular-time decision, extra time, and penalties (these three must also sum to 100).
- Use the provided match data (score, minute, stats, rankings) as your primary input.
- Consider: scoreline, time remaining, shots on target, possession, corners, cards, team rankings, home advantage, tournament stage, group implications.
- If the match is live, heavily weight the current state. If upcoming, weight rankings and form.
- Add a concise plain-language explanation of your reasoning.
- Assign confidence: "high" when you have rich live data, "medium" with moderate data, "low" with minimal data.
- NEVER mention betting, odds, wagers, bookmakers, profit, or gambling.
- If data is incomplete, lower confidence and note what is missing.`;

const PREDICTION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "matchId", "homeWinPct", "drawPct", "awayWinPct",
    "confidence", "reasoningShort", "dataFreshness", "disclaimer",
  ],
  properties: {
    matchId: { type: "string" },
    homeWinPct: { type: "number" },
    drawPct: { type: "number" },
    awayWinPct: { type: "number" },
    regularTimeDecisionPct: { type: "number" },
    extraTimePct: { type: "number" },
    penaltiesPct: { type: "number" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    reasoningShort: { type: "string" },
    dataFreshness: { type: "string" },
    disclaimer: { type: "string" },
  },
} as const;

const VENUE_COORDS: Record<string, { lat: number; lon: number }> = {
  "MetLife Stadium": { lat: 40.8136, lon: -74.0745 },
  "AT&T Stadium": { lat: 32.7473, lon: -97.0945 },
  "Arrowhead Stadium": { lat: 39.0489, lon: -94.4839 },
  "Mercedes-Benz Stadium": { lat: 33.7555, lon: -84.401 },
  "NRG Stadium": { lat: 29.6847, lon: -95.4107 },
  "SoFi Stadium": { lat: 33.9534, lon: -118.339 },
  "Lincoln Financial Field": { lat: 39.9008, lon: -75.1675 },
  "Lumen Field": { lat: 47.5952, lon: -122.3316 },
  "Levi's Stadium": { lat: 37.4036, lon: -121.97 },
  "Gillette Stadium": { lat: 42.0909, lon: -71.2643 },
  "Hard Rock Stadium": { lat: 25.958, lon: -80.2389 },
  "BC Place": { lat: 49.2767, lon: -123.112 },
  "Estadio Azteca": { lat: 19.3029, lon: -99.1504 },
  "Estadio BBVA": { lat: 25.6702, lon: -100.2931 },
  "BMO Field": { lat: 43.6329, lon: -79.4185 },
  "Estadio Akron": { lat: 20.6818, lon: -103.4628 },
};

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getRanking(team: Match["homeTeam"]) {
  if (typeof team.ranking === "number") return team.ranking;
  const byCode = getTeamSeedByCode(team.code);
  if (byCode) return byCode.ranking;
  const byName = getTeamSeedByNameOrCode(team.name);
  return byName?.ranking;
}

function getElo(team: Match["homeTeam"]) {
  if (typeof team.elo === "number") return team.elo;
  const ranking = getRanking(team);
  return ranking ? rankingToElo(ranking) : undefined;
}

function getVenueCoord(venueName?: string) {
  if (!venueName) return undefined;
  for (const [key, coord] of Object.entries(VENUE_COORDS)) {
    if (venueName.includes(key) || key.includes(venueName)) return coord;
  }
  return undefined;
}

function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getPreviewVenueDistance(
  teamCode: string,
  currentKickoff: string,
  currentVenueName: string | undefined,
  allGroupMatches: Match[],
): number {
  if (!currentVenueName) return 0;
  const currentCoord = getVenueCoord(currentVenueName);
  if (!currentCoord) return 0;

  const prevMatch = allGroupMatches
    .filter(m =>
      (m.homeTeam.code === teamCode || m.awayTeam.code === teamCode) &&
      new Date(m.kickoff).getTime() < new Date(currentKickoff).getTime()
    )
    .sort((a, b) => new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime())[0];

  if (!prevMatch || !prevMatch.venue) return 0;
  const prevCoord = getVenueCoord(prevMatch.venue);
  if (!prevCoord) return 0;

  return haversineKm(prevCoord.lat, prevCoord.lon, currentCoord.lat, currentCoord.lon);
}

function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let prob = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) {
    prob *= lambda / i;
  }
  return Math.max(0, prob);
}

function estimateXgHome(
  match: Match,
  homeElo: number | undefined,
  awayElo: number | undefined,
  allGroupMatches: Match[],
  allStandings: { group: string; rows: { code: string; points: number; played: number }[] }[],
): { xgHome: number; xgAway: number; details: string[] } {
  const details: string[] = [];
  const BASELINE = 1.15;
  const AVG_ELO = 1800;

  const hElo = homeElo ?? AVG_ELO;
  const aElo = awayElo ?? AVG_ELO;

  let xgHome: number;
  let xgAway: number;

  if (match.status === "upcoming") {
    const BASELINE_HOME = 1.22;
    const BASELINE_AWAY = 1.08;
    const eloDiff = (hElo - aElo) / 1000;
    const eloAdjust = clamp(eloDiff * 0.18, -0.12, 0.12);

    xgHome = BASELINE_HOME + eloAdjust;
    xgAway = BASELINE_AWAY - eloAdjust;
    details.push(`baseline xG ${BASELINE_HOME} vs ${BASELINE_AWAY}, Elo adjust ${eloAdjust.toFixed(2)}`);

    const group = match.group;
    if (group) {
      const standing = allStandings.find(s => s.group === group);
      if (standing) {
        const homeRow = standing.rows.find(r => r.code === match.homeTeam.code);
        const awayRow = standing.rows.find(r => r.code === match.awayTeam.code);
        if (homeRow && awayRow && homeRow.played > 0) {
          const homePpg = homeRow.played > 0 ? homeRow.points / homeRow.played : 0;
          const awayPpg = awayRow.played > 0 ? awayRow.points / awayRow.played : 0;
          const ppgDelta = homePpg - awayPpg;
          xgHome += ppgDelta * 0.2;
          xgAway -= ppgDelta * 0.2;
          if (Math.abs(ppgDelta) > 0.5) details.push("group form adjustment applied");

          const maxPts = (standing.rows.length - 1 - homeRow.played) * 3;
          if (homeRow.points + maxPts < (standing.rows[2]?.points ?? 0)) {
            xgHome *= 1.05;
            details.push("must-win situation boost for home");
          }
          if (awayRow.points + maxPts < (standing.rows[2]?.points ?? 0)) {
            xgAway *= 1.05;
            details.push("must-win situation boost for away");
          }
        }
      }
    }

    const groupMatches = allGroupMatches.filter(m => m.group === match.group);
    const homePrevKickoff = groupMatches
      .filter(m => (m.homeTeam.code === match.homeTeam.code || m.awayTeam.code === match.homeTeam.code) && m.id !== match.id)
      .map(m => new Date(m.kickoff).getTime())
      .sort((a, b) => b - a)[0];
    if (homePrevKickoff) {
      const restDays = Math.round((new Date(match.kickoff).getTime() - homePrevKickoff) / 86400000);
      if (restDays < 3) { xgHome *= 0.95; details.push(`short rest for home (${restDays}d)`); }
      else if (restDays > 5) { xgHome *= 1.03; details.push(`extended rest for home (${restDays}d)`); }
    }

    const awayPrevKickoff = groupMatches
      .filter(m => (m.homeTeam.code === match.awayTeam.code || m.awayTeam.code === match.awayTeam.code) && m.id !== match.id)
      .map(m => new Date(m.kickoff).getTime())
      .sort((a, b) => b - a)[0];
    if (awayPrevKickoff) {
      const restDays = Math.round((new Date(match.kickoff).getTime() - awayPrevKickoff) / 86400000);
      if (restDays < 3) { xgAway *= 0.95; details.push(`short rest for away (${restDays}d)`); }
      else if (restDays > 5) { xgAway *= 1.03; details.push(`extended rest for away (${restDays}d)`); }
    }

    const homeTravel = getPreviewVenueDistance(match.homeTeam.code, match.kickoff, match.venue, allGroupMatches);
    const awayTravel = getPreviewVenueDistance(match.awayTeam.code, match.kickoff, match.venue, allGroupMatches);
    if (homeTravel > 2000) { xgHome *= 0.97; details.push(`travel fatigue for home (${Math.round(homeTravel)}km)`); }
    if (awayTravel > 2000) { xgAway *= 0.97; details.push(`travel fatigue for away (${Math.round(awayTravel)}km)`); }
  } else {
    const homeEloFactor = Math.exp((hElo - AVG_ELO) / 800);
    const awayEloFactor = Math.exp((aElo - AVG_ELO) / 800);

    xgHome = BASELINE * homeEloFactor;
    xgAway = BASELINE * awayEloFactor;

    const homeAdv = match.status === "live" || match.status === "halftime" ? 1.06 : 1.03;
    xgHome *= homeAdv;

    if (match.status === "live" || match.status === "halftime") {
      const homeScore = match.homeScore ?? 0;
      const awayScore = match.awayScore ?? 0;
      const minute = clamp(match.minute ?? 0, 0, 120);
      const remainingPct = clamp((90 - minute) / 90, 0.05, 1);

      xgHome *= remainingPct;
      xgAway *= remainingPct;

      xgHome += homeScore;
      xgAway += awayScore;

      if (homeScore > awayScore) {
        xgHome *= 0.95;
        xgAway *= 1.1;
        details.push("leading team defending, trailing team pushing");
      } else if (awayScore > homeScore) {
        xgHome *= 1.1;
        xgAway *= 0.95;
        details.push("trailing home team pushing, leading away team defending");
      }

      if (match.stats) {
        const shotsOnTarg = toNumber(match.stats.shotsOnTarget?.home) - toNumber(match.stats.shotsOnTarget?.away);
        if (shotsOnTarg !== 0) {
          xgHome += shotsOnTarg * 0.08;
          xgAway -= shotsOnTarg * 0.08;
          details.push("shots-on-target adjustment applied");
        }

        const dangerDelta = toNumber(match.stats.dangerousAttacks?.home) - toNumber(match.stats.dangerousAttacks?.away);
        if (dangerDelta !== 0) {
          xgHome += dangerDelta * 0.03;
          xgAway -= dangerDelta * 0.03;
          details.push("dangerous attacks adjustment applied");
        }

        const savesHome = toNumber(match.stats.goalkeeperSaves?.home);
        const savesAway = toNumber(match.stats.goalkeeperSaves?.away);
        if (savesHome > 0) xgAway -= savesHome * 0.05;
        if (savesAway > 0) xgHome -= savesAway * 0.05;

        const rcHome = toNumber(match.stats.redCards?.home);
        const rcAway = toNumber(match.stats.redCards?.away);
        if (rcHome > 0) xgHome *= 1 - rcHome * 0.2;
        if (rcAway > 0) xgAway *= 1 - rcAway * 0.2;
        if (rcHome > 0 || rcAway > 0) details.push("red card penalty applied");
      }

      xgHome = Math.max(0.05, xgHome);
      xgAway = Math.max(0.05, xgAway);
    }
  }

  xgHome = clamp(xgHome, 0.05, 6);
  xgAway = clamp(xgAway, 0.05, 6);

  return { xgHome, xgAway, details };
}

function poissonPrediction(xgHome: number, xgAway: number, isKnockout: boolean): {
  homeWinPct: number; drawPct: number; awayWinPct: number;
  xtra?: { regularTimeDecisionPct: number; extraTimePct: number; penaltiesPct: number };
} {
  const MAX_GOALS = 10;
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (let i = 0; i <= MAX_GOALS; i++) {
    const pI = poissonPmf(i, xgHome);
    for (let j = 0; j <= MAX_GOALS; j++) {
      const pJ = poissonPmf(j, xgAway);
      const joint = pI * pJ;
      if (i > j) homeWin += joint;
      else if (i < j) awayWin += joint;
      else draw += joint;
    }
  }

  const total = homeWin + draw + awayWin;
  const homeWinPct = (homeWin / total) * 100;
  const drawPct = (draw / total) * 100;
  const awayWinPct = (awayWin / total) * 100;

  let xtra: { regularTimeDecisionPct: number; extraTimePct: number; penaltiesPct: number } | undefined;
  if (isKnockout) {
    const nonDraw = 100 - drawPct;
    const decision = nonDraw;
    const xtraPct = drawPct * 0.55;
    const penPct = drawPct * 0.45;
    const [regularTimeDecisionPct, extraTimePct, penaltiesPct] = normalizePercentages([decision, xtraPct, penPct]);
    xtra = { regularTimeDecisionPct, extraTimePct, penaltiesPct };
  }

  return { homeWinPct, drawPct, awayWinPct, xtra };
}

function buildHeuristicPrediction(
  match: Match,
  allGroupMatches: Match[],
  allStandings: { group: string; rows: { code: string; points: number; played: number }[] }[],
): Prediction {
  const homeScore = match.homeScore ?? 0;
  const awayScore = match.awayScore ?? 0;
  const isKnockout = isKnockoutMatch(match);

  if (match.status === "finished") {
    const homeWinPct = homeScore > awayScore ? 100 : 0;
    const drawPct = homeScore === awayScore ? 100 : 0;
    const awayWinPct = awayScore > homeScore ? 100 : 0;
    let regularTimeDecisionPct: number | undefined;
    let extraTimePct: number | undefined;
    let penaltiesPct: number | undefined;
    if (isKnockout) {
      if (homeScore !== awayScore) { regularTimeDecisionPct = 100; extraTimePct = 0; penaltiesPct = 0; }
      else { regularTimeDecisionPct = 0; extraTimePct = 0; penaltiesPct = 100; }
    }

    return {
      matchId: match.id,
      homeWinPct, drawPct, awayWinPct,
      regularTimeDecisionPct, extraTimePct, penaltiesPct,
      confidence: "high",
      reasoningShort: `Completed: ${homeScore}-${awayScore}.`,
      dataFreshness: "Final result",
      disclaimer: DISCLAIMER,
      estimateSource: "heuristic",
    };
  }

  const homeElo = getElo(match.homeTeam);
  const awayElo = getElo(match.awayTeam);

  const { xgHome, xgAway, details } = estimateXgHome(
    match, homeElo, awayElo, allGroupMatches, allStandings,
  );

  const result = poissonPrediction(xgHome, xgAway, isKnockout);

  const [homeWinPct, drawPct, awayWinPct] = normalizePercentages([
    result.homeWinPct, result.drawPct, result.awayWinPct,
  ]);

  let regularTimeDecisionPct: number | undefined;
  let extraTimePct: number | undefined;
  let penaltiesPct: number | undefined;
  if (result.xtra) {
    [regularTimeDecisionPct, extraTimePct, penaltiesPct] = normalizePercentages([
      result.xtra.regularTimeDecisionPct,
      result.xtra.extraTimePct,
      result.xtra.penaltiesPct,
    ]);
  }

  const dataPoints =
    (match.status === "live" || match.status === "halftime" ? 1 : 0) +
    (match.minute ? 1 : 0) +
    (match.stats ? 1 : 0) +
    ((match.events?.length ?? 0) > 0 ? 1 : 0) +
    (typeof homeElo === "number" ? 1 : 0);

  const confidence = dataPoints >= 4 ? "high" : dataPoints >= 2 ? "medium" : "low";

  const parts = [
    match.minute ? `${match.minute}' ${homeScore}-${awayScore}` : null,
    ...details,
    `Elo: ${Math.round(homeElo ?? 0)} vs ${Math.round(awayElo ?? 0)}`,
    `xG: ${xgHome.toFixed(2)} vs ${xgAway.toFixed(2)}`,
  ].filter(Boolean);

  return {
    matchId: match.id,
    homeWinPct, drawPct, awayWinPct,
    regularTimeDecisionPct, extraTimePct, penaltiesPct,
    confidence,
    reasoningShort: parts.join(". ") + ".",
    dataFreshness: "Poisson xG estimate",
    disclaimer: DISCLAIMER,
    estimateSource: "heuristic",
  };
}

function blendValues(primary: number, secondary: number, primaryWeight: number) {
  return primary * primaryWeight + secondary * (1 - primaryWeight);
}

function getPredictionInput(match: Match) {
  const homeRanking = getRanking(match.homeTeam);
  const awayRanking = getRanking(match.awayTeam);
  return {
    matchId: match.id,
    competition: "FIFA World Cup 2026",
    stage: match.stage,
    group: match.group ?? null,
    teams: {
      home: { name: match.homeTeam.name, code: match.homeTeam.code, ranking: homeRanking ?? null },
      away: { name: match.awayTeam.name, code: match.awayTeam.code, ranking: awayRanking ?? null },
    },
    status: match.status,
    minute: match.minute ?? null,
    kickoff: match.kickoff,
    score: { home: match.homeScore ?? null, away: match.awayScore ?? null },
    stats: match.stats ?? null,
    events: match.events?.slice(-10) ?? [],
    isKnockout: isKnockoutMatch(match),
  };
}

function normalizePrediction(match: Match, prediction: Partial<Prediction> | null, allGroupMatches: Match[], allStandings: { group: string; rows: { code: string; points: number; played: number }[] }[]) {
  const heuristic = buildHeuristicPrediction(match, allGroupMatches, allStandings);
  const hasLiveContext =
    match.status === "live" || match.status === "halftime" ||
    Boolean(match.stats) || (match.events?.length ?? 0) > 0;

  if (!prediction || !hasLiveContext) return heuristic;

  const remoteThreeWay = normalizePercentages([
    toNumber(prediction.homeWinPct), toNumber(prediction.drawPct), toNumber(prediction.awayWinPct),
  ]);
  const remoteSpread = Math.max(...remoteThreeWay) - Math.min(...remoteThreeWay);
  const heuristicSpread =
    Math.max(heuristic.homeWinPct, heuristic.drawPct, heuristic.awayWinPct) -
    Math.min(heuristic.homeWinPct, heuristic.drawPct, heuristic.awayWinPct);
  let heuristicWeight = hasLiveContext ? 0.30 : 0.85;
  if (remoteSpread <= 2 && heuristicSpread >= 6) heuristicWeight = 0.95;

  const [homeWinPct, drawPct, awayWinPct] = normalizePercentages([
    blendValues(heuristic.homeWinPct, remoteThreeWay[0], heuristicWeight),
    blendValues(heuristic.drawPct, remoteThreeWay[1], heuristicWeight),
    blendValues(heuristic.awayWinPct, remoteThreeWay[2], heuristicWeight),
  ]);

  let regularTimeDecisionPct = prediction.regularTimeDecisionPct;
  let extraTimePct = prediction.extraTimePct;
  let penaltiesPct = prediction.penaltiesPct;

  if (isKnockoutMatch(match)) {
    [regularTimeDecisionPct, extraTimePct, penaltiesPct] = normalizePercentages([
      blendValues(heuristic.regularTimeDecisionPct ?? 0, toNumber(prediction.regularTimeDecisionPct), heuristicWeight),
      blendValues(heuristic.extraTimePct ?? 0, toNumber(prediction.extraTimePct), heuristicWeight),
      blendValues(heuristic.penaltiesPct ?? 0, toNumber(prediction.penaltiesPct), heuristicWeight),
    ]);
  }

  return {
    matchId: match.id,
    homeWinPct, drawPct, awayWinPct,
    regularTimeDecisionPct, extraTimePct, penaltiesPct,
    confidence:
      prediction.confidence === "high" || prediction.confidence === "medium" || prediction.confidence === "low"
        ? prediction.confidence : heuristic.confidence,
    reasoningShort: prediction.reasoningShort?.trim() || heuristic.reasoningShort,
    dataFreshness: prediction.dataFreshness?.trim() || "Fresh estimate",
    disclaimer: prediction.disclaimer?.trim() || DISCLAIMER,
    estimateSource: heuristicWeight >= 0.99 ? "heuristic" : heuristicWeight > 0.5 ? "openai-blended" : "openai",
  } satisfies Prediction;
}

async function fetchOpenAiPrediction(match: Match) {
  if (!process.env.OPENAI_API_KEY) return null;
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const input = getPredictionInput(match);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: OPENAI_SYSTEM_PROMPT,
      input: JSON.stringify(input),
      max_output_tokens: 500,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "match_prediction",
          schema: PREDICTION_RESPONSE_SCHEMA,
          strict: true,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const requestId = response.headers.get("x-request-id");
    console.warn(`OpenAI prediction request failed with ${response.status}${requestId ? ` (request ${requestId})` : ""}: ${errorText}`);
    return null;
  }

  const payload = (await response.json()) as {
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  const content = payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text")
    ?.text;
  return content ? safeJsonParse<Partial<Prediction>>(content) : null;
}

export async function getPredictionForMatch(match: Match) {
  return getCachedValue(`prediction:${match.id}`, PREDICTION_TTL_MS, async () => {
    try {
      const remotePrediction = await fetchOpenAiPrediction(match);
      const snapshot = await import("@/lib/providers/combinedProvider").then(m =>
        m.getDashboardSnapshot()
      );
      const allGroupMatches = snapshot.matches.filter(m => m.group === match.group);
      const allStandings = snapshot.standings.map(s => ({
        group: s.group,
        rows: s.rows.map(r => ({ code: r.team.code, points: r.points, played: r.played })),
      }));

      const normalized = normalizePrediction(match, remotePrediction, allGroupMatches, allStandings);
      setCachedValue(`prediction:${match.id}`, normalized, PREDICTION_TTL_MS);
      return normalized;
    } catch (error) {
      console.warn("Prediction generation failed, falling back to heuristic estimate:", error);
      return buildHeuristicPrediction(match, [], []);
    }
  });
}

export async function getPredictionsForMatches(matches: Match[]) {
  return Promise.all(matches.map((match) => getPredictionForMatch(match)));
}
