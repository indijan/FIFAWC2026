import { Match, Prediction } from "@/lib/types";
import { getTeamSeedByCode, getTeamSeedByNameOrCode } from "@/lib/team-metadata";
import { getCachedValue, setCachedValue } from "@/lib/server-cache";
import { clamp, isKnockoutMatch, normalizePercentages, safeJsonParse } from "@/lib/utils";

const PREDICTION_TTL_MS = 2 * 60_000;
const DISCLAIMER = "Informational AI estimate only. Not betting or financial advice.";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const OPENAI_SYSTEM_PROMPT =
  "You are an informational football probability estimator, not a betting advisor. Estimate match outcome probabilities from the supplied match data only. Do not mention betting, odds, wagers, bookmakers, profit, or gambling. Return calibrated percentages that sum to 100 for home/draw/away. For knockout matches, also estimate regular-time decision, extra time, and penalties. Add a short plain-language explanation and confidence level. If data is incomplete, lower confidence and mention limited data.";
const PREDICTION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "matchId",
    "homeWinPct",
    "drawPct",
    "awayWinPct",
    "confidence",
    "reasoningShort",
    "dataFreshness",
    "disclaimer",
  ],
  properties: {
    matchId: { type: "string" },
    homeWinPct: { type: "number" },
    drawPct: { type: "number" },
    awayWinPct: { type: "number" },
    regularTimeDecisionPct: { type: "number" },
    extraTimePct: { type: "number" },
    penaltiesPct: { type: "number" },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
    },
    reasoningShort: { type: "string" },
    dataFreshness: { type: "string" },
    disclaimer: { type: "string" },
  },
} as const;

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getRanking(team: Match["homeTeam"]) {
  if (typeof team.ranking === "number") {
    return team.ranking;
  }

  const byCode = getTeamSeedByCode(team.code);

  if (byCode) {
    return byCode.ranking;
  }

  const byName = getTeamSeedByNameOrCode(team.name);
  return byName?.ranking;
}

function buildHeuristicPrediction(match: Match): Prediction {
  const homeScore = match.homeScore ?? 0;
  const awayScore = match.awayScore ?? 0;
  const scoreDelta = homeScore - awayScore;
  const minute = clamp(match.minute ?? (match.status === "finished" ? 90 : 0), 0, 120);
  const shotsDelta = toNumber(match.stats?.shotsOnTarget?.home) - toNumber(match.stats?.shotsOnTarget?.away);
  const redCardDelta = toNumber(match.stats?.redCards?.away) - toNumber(match.stats?.redCards?.home);
  const homeRanking = getRanking(match.homeTeam);
  const awayRanking = getRanking(match.awayTeam);
  const rankingDelta =
    typeof homeRanking === "number" && typeof awayRanking === "number"
      ? awayRanking - homeRanking
      : 0;
  const rankingWeight = clamp(rankingDelta * 0.45, -18, 18);
  const homeAdvantage = match.status === "upcoming" ? 5 : 3;
  const kickoffHours = Math.max(
    0,
    Math.round((new Date(match.kickoff).getTime() - Date.now()) / 3_600_000),
  );
  const imminenceAdjustment = match.status === "upcoming" ? clamp(6 - kickoffHours, 0, 6) * 0.6 : 0;

  let homeWeight =
    33 +
    rankingWeight +
    homeAdvantage +
    imminenceAdjustment +
    scoreDelta * 16 +
    (minute / 90) * 6 +
    shotsDelta * 2 +
    redCardDelta * 7;
  let drawWeight = 28 - Math.abs(scoreDelta) * 8 + (match.status === "live" ? 8 : 16 - imminenceAdjustment * 0.8);
  let awayWeight = 33 - rankingWeight - scoreDelta * 16 + (minute / 90) * 6 - shotsDelta * 2 - redCardDelta * 7;

  if (match.status === "finished") {
    if (homeScore > awayScore) {
      homeWeight = 100;
      drawWeight = 0;
      awayWeight = 0;
    } else if (homeScore < awayScore) {
      homeWeight = 0;
      drawWeight = 0;
      awayWeight = 100;
    } else {
      homeWeight = 0;
      drawWeight = 100;
      awayWeight = 0;
    }
  }

  const [homeWinPct, drawPct, awayWinPct] = normalizePercentages([
    homeWeight,
    drawWeight,
    awayWeight,
  ]);

  let regularTimeDecisionPct: number | undefined;
  let extraTimePct: number | undefined;
  let penaltiesPct: number | undefined;

  if (isKnockoutMatch(match)) {
    const decisionBase = clamp(100 - drawPct * 0.9, 40, 92);
    const extraTimeBase = clamp(drawPct * 0.55, 5, 42);
    const penaltiesBase = clamp(drawPct * 0.35, 3, 28);
    [regularTimeDecisionPct, extraTimePct, penaltiesPct] = normalizePercentages([
      decisionBase,
      extraTimeBase,
      penaltiesBase,
    ]);
  }

  const confidenceScore =
    (match.status === "live" ? 1 : 0) +
    (match.minute ? 1 : 0) +
    (match.stats ? 1 : 0) +
    ((match.events?.length ?? 0) > 0 ? 1 : 0);

  const confidence =
    confidenceScore >= 3 ? "high" : confidenceScore >= 2 ? "medium" : "low";

  const stateBits = [
    scoreDelta !== 0 ? `score state ${homeScore}-${awayScore}` : "level scoreline",
    match.minute ? `${match.minute}' match state` : "pre-match setup",
    rankingDelta !== 0 ? "team-strength context included" : "limited team-strength context",
    match.stats?.redCards ? "discipline events included" : "limited event data",
  ];

  return {
    matchId: match.id,
    homeWinPct,
    drawPct,
    awayWinPct,
    regularTimeDecisionPct,
    extraTimePct,
    penaltiesPct,
    confidence,
    reasoningShort: `Model estimate reflects ${stateBits.join(", ")}.`,
    dataFreshness: "Live estimate",
    disclaimer: DISCLAIMER,
    estimateSource: "heuristic",
  };
}

function blendValues(primary: number, secondary: number, primaryWeight: number) {
  return primary * primaryWeight + secondary * (1 - primaryWeight);
}

function getPredictionInput(match: Match) {
  return {
    matchId: match.id,
    teams: {
      home: match.homeTeam.name,
      away: match.awayTeam.name,
    },
    kickoff: match.kickoff,
    status: match.status,
    minute: match.minute,
    stage: match.stage,
    group: match.group,
    score: {
      home: match.homeScore,
      away: match.awayScore,
    },
    rankings: {
      home: getRanking(match.homeTeam),
      away: getRanking(match.awayTeam),
    },
    stats: match.stats,
    events: match.events,
  };
}

function normalizePrediction(match: Match, prediction: Partial<Prediction> | null) {
  const heuristic = buildHeuristicPrediction(match);
  const hasLiveContext =
    match.status === "live" ||
    match.status === "halftime" ||
    Boolean(match.stats) ||
    (match.events?.length ?? 0) > 0;

  if (!prediction || !hasLiveContext) {
    return heuristic;
  }

  const remoteThreeWay = normalizePercentages([
    toNumber(prediction.homeWinPct),
    toNumber(prediction.drawPct),
    toNumber(prediction.awayWinPct),
  ]);
  const remoteSpread = Math.max(...remoteThreeWay) - Math.min(...remoteThreeWay);
  const heuristicSpread = Math.max(heuristic.homeWinPct, heuristic.drawPct, heuristic.awayWinPct) -
    Math.min(heuristic.homeWinPct, heuristic.drawPct, heuristic.awayWinPct);
  let heuristicWeight = hasLiveContext ? 0.35 : 0.85;

  if (remoteSpread <= 2 && heuristicSpread >= 6) {
    heuristicWeight = 0.95;
  }

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
      blendValues(
        heuristic.regularTimeDecisionPct ?? 0,
        toNumber(prediction.regularTimeDecisionPct),
        heuristicWeight,
      ),
      blendValues(heuristic.extraTimePct ?? 0, toNumber(prediction.extraTimePct), heuristicWeight),
      blendValues(heuristic.penaltiesPct ?? 0, toNumber(prediction.penaltiesPct), heuristicWeight),
    ]);
  }

  return {
    matchId: match.id,
    homeWinPct,
    drawPct,
    awayWinPct,
    regularTimeDecisionPct,
    extraTimePct,
    penaltiesPct,
    confidence:
      prediction.confidence === "high" || prediction.confidence === "medium" || prediction.confidence === "low"
        ? prediction.confidence
        : heuristic.confidence,
    reasoningShort:
      prediction.reasoningShort?.trim() || heuristic.reasoningShort,
    dataFreshness: prediction.dataFreshness?.trim() || "Fresh estimate",
    disclaimer: prediction.disclaimer?.trim() || DISCLAIMER,
    estimateSource: heuristicWeight >= 0.99 ? "heuristic" : heuristicWeight > 0.5 ? "openai-blended" : "openai",
  } satisfies Prediction;
}

async function fetchOpenAiPrediction(match: Match) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

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
      max_output_tokens: 350,
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
    console.warn(
      `OpenAI prediction request failed with ${response.status}${requestId ? ` (request ${requestId})` : ""}: ${errorText}`,
    );
    return null;
  }

  const payload = (await response.json()) as {
    output?: Array<{
      type?: string;
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
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
      const normalized = normalizePrediction(match, remotePrediction);
      setCachedValue(`prediction:${match.id}`, normalized, PREDICTION_TTL_MS);
      return normalized;
    } catch (error) {
      console.warn("Prediction generation failed, falling back to heuristic estimate:", error);
      return buildHeuristicPrediction(match);
    }
  });
}

export async function getPredictionsForMatches(matches: Match[]) {
  return Promise.all(matches.map((match) => getPredictionForMatch(match)));
}
