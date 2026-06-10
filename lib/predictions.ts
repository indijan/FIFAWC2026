import { Match, Prediction } from "@/lib/types";
import { getTeamSeedByCode, getTeamSeedByNameOrCode, rankingToElo } from "@/lib/team-metadata";
import { getCachedValue, setCachedValue } from "@/lib/server-cache";
import { clamp, isKnockoutMatch, normalizePercentages, safeJsonParse } from "@/lib/utils";

// ══════════════════════════════════════════════════════════════
// CONFIGURABLE WEIGHTS — tune these, not hardcoded logic
// ══════════════════════════════════════════════════════════════

const PRE_MATCH_WEIGHTS = {
  eloRating: 0.22,
  avgGoalsScored: 0.10,
  avgGoalsConceded: 0.10,
  cleanSheetPct: 0.06,
  shotsOnTarget: 0.05,
  possession: 0.04,
  worldCupHistory: 0.10,
  restDays: 0.06,
  travelDistance: 0.04,
  headToHead: 0.08,
  recentForm: 0.15,
} as const;

const DOMINANCE_WEIGHTS = {
  xgDiff: 0.20,
  shotDiff: 0.12,
  sotDiff: 0.15,
  possession: 0.10,
  cornersDiff: 0.06,
  dangerAttacksDiff: 0.14,
  passAccuracyDiff: 0.08,
  redCards: 0.10,
  yellowCards: 0.05,
} as const;

const TIME_DECAY_LAMBDA = 3.5;
const SIMULATION_COUNT = 5000;
const MOMENTUM_HALF_LIFE = 4;

// ══════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════

const PREDICTION_TTL_MS = 2 * 60_000;
const DISCLAIMER = "Informational probability estimate only. Not betting advice.";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const AVG_ELO = 1700;
const BASELINE = 1.15;
const MAX_GOALS = 9;

const OPENAI_SYSTEM_PROMPT = `You are an AI football analyst interpreting quantitative predictions.

IMPORTANT: You are NOT the predictor. The mathematical model already computed the probabilities. Your job is to verify logical consistency, provide a short explanation, and detect contradictions.

RULES:
- Do NOT invent your own probabilities. Use the provided Monte Carlo output as primary.
- You may slightly calibrate if you detect a logical inconsistency (max ±3%).
- Generate a concise human-readable reasoning (2-3 sentences).
- Assign confidence based on data completeness.
- For knockout matches, estimate regular-time decision / extra time / penalties.
- NEVER mention betting, odds, wagers, bookmakers, profit, or gambling.
- NEVER fabricate statistics not present in the input.`;

const PREDICTION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "matchId", "homeWin", "draw", "awayWin",
    "confidence", "reasoning", "disclaimer",
  ],
  properties: {
    matchId: { type: "string" },
    homeWin: { type: "number" },
    draw: { type: "number" },
    awayWin: { type: "number" },
    regularTimeDecision: { type: "number" },
    extraTime: { type: "number" },
    penalties: { type: "number" },
    confidence: { type: "string", enum: ["very low", "low", "medium", "high", "very high"] },
    reasoning: { type: "string" },
    disclaimer: { type: "string" },
  },
} as const;

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

function toNumber(v: unknown) { return typeof v === "number" && Number.isFinite(v) ? v : 0; }

function getRanking(team: Match["homeTeam"]) {
  if (typeof team.ranking === "number") return team.ranking;
  const seed = getTeamSeedByCode(team.code) ?? getTeamSeedByNameOrCode(team.name);
  return seed?.ranking;
}

function getElo(team: Match["homeTeam"]) {
  if (typeof team.elo === "number") return team.elo;
  const rank = getRanking(team);
  return rank ? rankingToElo(rank) : undefined;
}

function safePct(v: number) { return clamp(v, 0.1, 99.9); }

function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

// ══════════════════════════════════════════════════════════════
// STEP 1: PRE-MATCH STRENGTH MODEL
// ══════════════════════════════════════════════════════════════

interface StrengthInput {
  elo?: number;
  avgGoalsScored?: number;
  avgGoalsConceded?: number;
  cleanSheetPct?: number;
  shotsOnTarget?: number;
  possession?: number;
  worldCupHistory?: number;
  restDays?: number;
  travelKm?: number;
  headToHeadWinPct?: number;
  recentFormPpg?: number;
}

function normalizeStrengthFeature(value: number | undefined, min: number, max: number): number {
  if (value === undefined) return 0.5;
  return clamp((value - min) / (max - min), 0, 1);
}

function computeTeamStrength(input: StrengthInput): number {
  const features: Record<string, number> = {
    eloRating: normalizeStrengthFeature(input.elo, 1400, 2100),
    avgGoalsScored: normalizeStrengthFeature(input.avgGoalsScored, 0.5, 3.0),
    avgGoalsConceded: 1 - normalizeStrengthFeature(input.avgGoalsConceded, 0.3, 2.5),
    cleanSheetPct: normalizeStrengthFeature(input.cleanSheetPct, 0, 60),
    shotsOnTarget: normalizeStrengthFeature(input.shotsOnTarget, 1, 8),
    possession: normalizeStrengthFeature(input.possession, 30, 70),
    worldCupHistory: normalizeStrengthFeature(input.worldCupHistory, 0, 100),
    restDays: normalizeStrengthFeature(input.restDays, 2, 7),
    travelDistance: 1 - normalizeStrengthFeature(input.travelKm, 0, 5000),
    headToHead: normalizeStrengthFeature(input.headToHeadWinPct, 0, 100),
    recentForm: normalizeStrengthFeature(input.recentFormPpg, 0, 3),
  };

  let total = 0;
  for (const [key, weight] of Object.entries(PRE_MATCH_WEIGHTS)) {
    total += (features[key] ?? 0.5) * weight;
  }
  return clamp(total, 0, 1);
}

function buildStrengthInput(
  team: Match["homeTeam"],
  opponent: Match["homeTeam"],
  allGroupMatches: Match[],
  currentKickoff: string,
): StrengthInput {
  const elo = getElo(team) ?? AVG_ELO;

  const teamMatches = allGroupMatches.filter(m =>
    (m.homeTeam.code === team.code || m.awayTeam.code === team.code)
  );
  const prevMatches = teamMatches.filter(m => m.status === "finished");

  const goalsScored = prevMatches.reduce((s, m) =>
    s + (m.homeTeam.code === team.code ? (m.homeScore ?? 0) : (m.awayScore ?? 0)), 0);
  const goalsConceded = prevMatches.reduce((s, m) =>
    s + (m.homeTeam.code === team.code ? (m.awayScore ?? 0) : (m.homeScore ?? 0)), 0);
  const cleanSheets = prevMatches.filter(m =>
    (m.homeTeam.code === team.code ? (m.awayScore ?? 0) : (m.homeScore ?? 0)) === 0
  ).length;

  const avgGoalsScored = prevMatches.length > 0 ? goalsScored / prevMatches.length : undefined;
  const avgGoalsConceded = prevMatches.length > 0 ? goalsConceded / prevMatches.length : undefined;
  const cleanSheetPct = prevMatches.length > 0 ? (cleanSheets / prevMatches.length) * 100 : undefined;

  const shotsOnTarget = prevMatches.reduce((s, m) => {
    const isHome = m.homeTeam.code === team.code;
    return s + toNumber(isHome ? m.stats?.shotsOnTarget?.home : m.stats?.shotsOnTarget?.away);
  }, 0);
  const avgShotsOnTarget = prevMatches.length > 0 ? shotsOnTarget / prevMatches.length : undefined;

  const possessionVals = prevMatches.map(m => {
    const isHome = m.homeTeam.code === team.code;
    return toNumber(isHome ? m.stats?.possession?.home : m.stats?.possession?.away);
  }).filter(v => v > 0);
  const avgPossession = possessionVals.length > 0
    ? possessionVals.reduce((a, b) => a + b, 0) / possessionVals.length : undefined;

  const worldCupHistory = elo ? clamp((elo - 1500) / 6, 0, 100) : 50;

  const prevKickoff = teamMatches
    .filter(m => new Date(m.kickoff).getTime() < new Date(currentKickoff).getTime())
    .map(m => new Date(m.kickoff).getTime())
    .sort((a, b) => b - a)[0];
  const restDays = prevKickoff
    ? Math.round((new Date(currentKickoff).getTime() - prevKickoff) / 86400000)
    : 7;

  const wins = prevMatches.filter(m => {
    const isHome = m.homeTeam.code === team.code;
    const hs = m.homeScore ?? 0; const as = m.awayScore ?? 0;
    return isHome ? hs > as : as > hs;
  }).length;
  const draws = prevMatches.filter(m => (m.homeScore ?? 0) === (m.awayScore ?? 0)).length;
  const recentFormPpg = prevMatches.length > 0 ? (wins * 3 + draws) / prevMatches.length : undefined;

  return {
    elo, avgGoalsScored, avgGoalsConceded, cleanSheetPct,
    shotsOnTarget: avgShotsOnTarget, possession: avgPossession,
    worldCupHistory, restDays, travelKm: 0,
    headToHeadWinPct: undefined, recentFormPpg,
  };
}

// ══════════════════════════════════════════════════════════════
// STEP 3: DOMINANCE INDEX  (-100 to +100)
// ══════════════════════════════════════════════════════════════

function computeDominanceIndex(match: Match): number {
  if (!match.stats) return 0;

  const xgH = toNumber(match.stats.xg?.home);
  const xgA = toNumber(match.stats.xg?.away);
  const sotH = toNumber(match.stats.shotsOnTarget?.home);
  const sotA = toNumber(match.stats.shotsOnTarget?.away);
  const shotsH = toNumber(match.stats.shots?.home);
  const shotsA = toNumber(match.stats.shots?.away);
  const possH = toNumber(match.stats.possession?.home);
  const cornersH = toNumber(match.stats.corners?.home);
  const cornersA = toNumber(match.stats.corners?.away);
  const dangerH = toNumber(match.stats.dangerousAttacks?.home);
  const dangerA = toNumber(match.stats.dangerousAttacks?.away);
  const totalPassesH = toNumber(match.stats.totalPasses?.home);
  const totalPassesA = toNumber(match.stats.totalPasses?.away);
  const accuratePassesH = toNumber(match.stats.passesAccurate?.home);
  const accuratePassesA = toNumber(match.stats.passesAccurate?.away);
  const rcH = toNumber(match.stats.redCards?.home);
  const rcA = toNumber(match.stats.redCards?.away);
  const ycH = toNumber(match.stats.yellowCards?.home);
  const ycA = toNumber(match.stats.yellowCards?.away);

  const xgDiff = clamp((xgH - xgA) * 25, -25, 25);
  const shotDiff = clamp((shotsH - shotsA) * 1.5, -15, 15);
  const sotDiff = clamp((sotH - sotA) * 3, -20, 20);
  const possDiff = possH > 0 ? (possH - 50) * 0.5 : 0;
  const cornersDiff = clamp((cornersH - cornersA) * 1.2, -10, 10);
  const dangerDiff = clamp((dangerH - dangerA) * 0.4, -20, 20);
  const passAccH = totalPassesH > 0 ? (accuratePassesH / totalPassesH) * 100 : 50;
  const passAccA = totalPassesA > 0 ? (accuratePassesA / totalPassesA) * 100 : 50;
  const passAccDiff = (passAccH - passAccA) * 0.5;
  const rcPenalty = (rcA - rcH) * 15;
  const ycPenalty = (ycA - ycH) * 2;

  let index = 0;
  index += xgDiff * DOMINANCE_WEIGHTS.xgDiff;
  index += shotDiff * DOMINANCE_WEIGHTS.shotDiff;
  index += sotDiff * DOMINANCE_WEIGHTS.sotDiff;
  index += possDiff * DOMINANCE_WEIGHTS.possession;
  index += cornersDiff * DOMINANCE_WEIGHTS.cornersDiff;
  index += dangerDiff * DOMINANCE_WEIGHTS.dangerAttacksDiff;
  index += passAccDiff * DOMINANCE_WEIGHTS.passAccuracyDiff;
  index += rcPenalty * DOMINANCE_WEIGHTS.redCards;
  index += ycPenalty * DOMINANCE_WEIGHTS.yellowCards;

  return Math.round(clamp(index, -100, 100));
}

// ══════════════════════════════════════════════════════════════
// STEP 4: TIME DECAY MODEL  (exponential, non-linear)
// ══════════════════════════════════════════════════════════════

function timeDecayFactor(minute: number): number {
  if (minute >= 90) return 0;
  return Math.exp(-TIME_DECAY_LAMBDA * (minute / 90));
}

function timeWeightedScoreImpact(scoreDelta: number, minute: number): number {
  const remainingFactor = timeDecayFactor(minute);
  return scoreDelta * (1 - remainingFactor) * 18 + scoreDelta * remainingFactor * 6;
}

// ══════════════════════════════════════════════════════════════
// STEP 5: SCORE STATE MODEL
// ══════════════════════════════════════════════════════════════

interface ScoreStateAdjustment {
  homeXgFactor: number;
  awayXgFactor: number;
  description: string;
}

function getScoreStateAdjustment(
  homeScore: number, awayScore: number, minute: number,
  rcHome: number, rcAway: number,
): ScoreStateAdjustment {
  const sd = homeScore - awayScore;
  const late = minute > 75;

  // Red cards dominate
  if (rcHome < rcAway) return { homeXgFactor: 1.25, awayXgFactor: 0.70, description: "home man advantage" };
  if (rcAway < rcHome) return { homeXgFactor: 0.70, awayXgFactor: 1.25, description: "away man advantage" };

  // Large leads — team ahead conserves
  if (sd >= 3) return { homeXgFactor: late ? 0.55 : 0.65, awayXgFactor: late ? 1.0 : 0.95, description: "comfortable home lead, conservative play" };
  if (sd <= -3) return { homeXgFactor: late ? 1.0 : 0.95, awayXgFactor: late ? 0.55 : 0.65, description: "comfortable away lead, conservative play" };

  // Two-goal leads
  if (sd === 2) return { homeXgFactor: late ? 0.65 : 0.75, awayXgFactor: late ? 1.15 : 1.05, description: "home two-goal lead" };
  if (sd === -2) return { homeXgFactor: late ? 1.15 : 1.05, awayXgFactor: late ? 0.65 : 0.75, description: "away two-goal lead" };

  // One-goal leads — trailing team pushes
  if (sd === 1) return { homeXgFactor: late ? 0.80 : 0.90, awayXgFactor: late ? 1.20 : 1.10, description: "home slim lead, away pushing" };
  if (sd === -1) return { homeXgFactor: late ? 1.20 : 1.10, awayXgFactor: late ? 0.80 : 0.90, description: "away slim lead, home pushing" };

  // Level — balanced but late game tension
  if (sd === 0 && late) return { homeXgFactor: 0.95, awayXgFactor: 0.95, description: "level late, both cautious" };

  return { homeXgFactor: 1.0, awayXgFactor: 1.0, description: "balanced" };
}

// ══════════════════════════════════════════════════════════════
// STEP 7: MOMENTUM ENGINE  (exponential smoothing, multi-window)
// ══════════════════════════════════════════════════════════════

function computeMomentum(
  events: Match["events"] | undefined,
  stats: Match["stats"] | undefined,
  minute: number,
): { momentum: number; description: string } {
  let raw = 0;
  const parts: string[] = [];

  if (events && events.length > 0) {
    const recentEvents = events.filter(e => e.minute && minute - e.minute <= 10);
    for (const ev of recentEvents) {
      const age = minute - (ev.minute ?? minute);
      const decayWeight = Math.exp(-age / MOMENTUM_HALF_LIFE);

      if (ev.type?.includes("Goal") || ev.type?.includes("goal")) {
        raw += ev.teamId ? decayWeight * 15 : 0;
        parts.push("goal momentum");
      }
      if (ev.type?.includes("Card") && ev.type?.includes("Red")) {
        raw -= ev.teamId ? decayWeight * 20 : 0;
        parts.push("red card shock");
      }
      if (ev.type?.includes("attack") || ev.type?.includes("Attack")) {
        raw += ev.teamId ? decayWeight * 2 : -decayWeight * 2;
      }
    }
  }

  if (stats) {
    const dangerH = toNumber(stats.dangerousAttacks?.home);
    const dangerA = toNumber(stats.dangerousAttacks?.away);
    if (dangerH + dangerA > 0) {
      raw += clamp((dangerH - dangerA) * 0.5, -10, 10);
    }
  }

  const momentum = Math.round(clamp(raw, -100, 100));
  return { momentum, description: parts.join(", ") || "neutral" };
}

// ══════════════════════════════════════════════════════════════
// STEP 8: POISSON-BASED SIMULATION  (MC-equivalent for goals)
// ══════════════════════════════════════════════════════════════

interface SimulationResult {
  homeWinPct: number;
  drawPct: number;
  awayWinPct: number;
  regularTimeDecisionPct?: number;
  extraTimePct?: number;
  penaltiesPct?: number;
  xgHome: number;
  xgAway: number;
}

function runPoissonSimulation(
  xgHome: number,
  xgAway: number,
  isKnockout: boolean,
): SimulationResult {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (let i = 0; i <= MAX_GOALS; i++) {
    const pi = poissonPmf(i, xgHome);
    for (let j = 0; j <= MAX_GOALS; j++) {
      const pj = poissonPmf(j, xgAway);
      const joint = pi * pj;
      if (i > j) homeWin += joint;
      else if (i < j) awayWin += joint;
      else draw += joint;
    }
  }

  const total = homeWin + draw + awayWin;
  const homeWinPct = (homeWin / total) * 100;
  const drawPct = (draw / total) * 100;
  const awayWinPct = (awayWin / total) * 100;

  let regularTimeDecisionPct: number | undefined;
  let extraTimePct: number | undefined;
  let penaltiesPct: number | undefined;

  if (isKnockout) {
    const nonDraw = 100 - drawPct;
    const [rdp, etp, pp] = normalizePercentages([
      nonDraw,
      clamp(drawPct * 0.55, 5, 50),
      clamp(drawPct * 0.45, 3, 40),
    ]);
    regularTimeDecisionPct = rdp;
    extraTimePct = etp;
    penaltiesPct = pp;
  }

  return { homeWinPct, drawPct, awayWinPct, regularTimeDecisionPct, extraTimePct, penaltiesPct, xgHome, xgAway };
}

// ══════════════════════════════════════════════════════════════
// STEP 9: CONFIDENCE MODEL
// ══════════════════════════════════════════════════════════════

function computeConfidence(
  match: Match,
  dataCompleteness: number,
): Prediction["confidence"] {
  if (match.status === "finished") return "very high";

  const dataPoints =
    (match.minute ? 1 : 0) +
    (match.stats ? 2 : 0) +
    ((match.events?.length ?? 0) > 0 ? 1 : 0) +
    (getElo(match.homeTeam) && getElo(match.awayTeam) ? 1 : 0) +
    dataCompleteness;

  if (dataPoints >= 6) return "high";
  if (dataPoints >= 4) return "medium";
  if (dataPoints >= 2) return "low";
  return "very low";
}

// ══════════════════════════════════════════════════════════════
// CORE: HYBRID PREDICTION ENGINE
// ══════════════════════════════════════════════════════════════

function buildHeuristicPrediction(
  match: Match,
  allGroupMatches: Match[],
  allStandings: { group: string; rows: { code: string; points: number; played: number }[] }[],
) {
  const homeScore = match.homeScore ?? 0;
  const awayScore = match.awayScore ?? 0;
  const minute = clamp(match.minute ?? 0, 0, 120);
  const isKnockout = isKnockoutMatch(match);

  if (match.status === "finished") {
    return {
      matchId: match.id,
      homeWinPct: homeScore > awayScore ? 100 : 0,
      drawPct: homeScore === awayScore ? 100 : 0,
      awayWinPct: awayScore > homeScore ? 100 : 0,
      regularTimeDecisionPct: isKnockout ? (homeScore !== awayScore ? 100 : 0) : undefined,
      extraTimePct: isKnockout ? 0 : undefined,
      penaltiesPct: isKnockout ? (homeScore === awayScore ? 100 : 0) : undefined,
      confidence: "very high" as Prediction["confidence"],
      reasoningShort: `Final: ${homeScore}-${awayScore}.`,
      dataFreshness: "Final result",
      disclaimer: DISCLAIMER,
      estimateSource: "heuristic" as const,
      dominanceIndex: 0,
      momentum: 0,
    };
  }

  // Step 1: Pre-match strength
  const homeInput = buildStrengthInput(match.homeTeam, match.awayTeam, allGroupMatches, match.kickoff);
  const awayInput = buildStrengthInput(match.awayTeam, match.homeTeam, allGroupMatches, match.kickoff);
  const homeStrength = computeTeamStrength(homeInput);
  const awayStrength = computeTeamStrength(awayInput);
  const strengthDiff = (homeStrength - awayStrength) * 100;

  // Steps 3: Dominance index
  const dominanceIndex = computeDominanceIndex(match);

  // Steps 4 & 5: Time decay + score state
  const timeFactor = timeDecayFactor(minute);
  const scoreImpact = timeWeightedScoreImpact(homeScore - awayScore, minute);

  const rcHome = toNumber(match.stats?.redCards?.home);
  const rcAway = toNumber(match.stats?.redCards?.away);
  const scoreState = getScoreStateAdjustment(homeScore, awayScore, minute, rcHome, rcAway);

  // Step 7: Momentum
  const { momentum, description: momentumDesc } = computeMomentum(match.events, match.stats, minute);

  // Compute xG for Poisson simulation
  let xgHome: number;
  let xgAway: number;

  if (match.status === "upcoming") {
    const hElo = getElo(match.homeTeam) ?? AVG_ELO;
    const aElo = getElo(match.awayTeam) ?? AVG_ELO;
    const eloDiff = hElo - aElo;
    const xgAdjustment = clamp(eloDiff / 300, -0.35, 0.35);
    xgHome = 1.20 + xgAdjustment;
    xgAway = 1.05 - xgAdjustment;
  } else {
    const homeEloF = Math.exp(((getElo(match.homeTeam) ?? AVG_ELO) - AVG_ELO) / 800);
    const awayEloF = Math.exp(((getElo(match.awayTeam) ?? AVG_ELO) - AVG_ELO) / 800);

    xgHome = BASELINE * homeEloF * 1.04 * scoreState.homeXgFactor;
    xgAway = BASELINE * awayEloF * scoreState.awayXgFactor;

    xgHome = xgHome * timeFactor + homeScore + scoreImpact * 0.015;
    xgAway = xgAway * timeFactor + awayScore - scoreImpact * 0.015;

    xgHome += clamp(momentum * 0.002, -0.15, 0.15);
    xgAway -= clamp(momentum * 0.002, -0.15, 0.15);
  }

  // Rest days & travel for upcoming
  if (match.status === "upcoming") {
    const homeRest = homeInput.restDays ?? 7;
    const awayRest = awayInput.restDays ?? 7;
    if (homeRest < 3) xgHome *= 0.94;
    if (awayRest < 3) xgAway *= 0.94;
    if (homeRest > 5) xgHome *= 1.04;
    if (awayRest > 5) xgAway *= 1.04;

    // Group situation
    const standing = allStandings.find(s => s.group === match.group);
    if (standing) {
      const hr = standing.rows.find(r => r.code === match.homeTeam.code);
      const ar = standing.rows.find(r => r.code === match.awayTeam.code);
      if (hr && ar && hr.played > 0) {
        const ppgDelta = (hr.points / hr.played) - (ar.points / ar.played);
        xgHome += ppgDelta * 0.15;
        xgAway -= ppgDelta * 0.15;
      }
    }
  }

  xgHome = clamp(xgHome, 0.05, 5.5);
  xgAway = clamp(xgAway, 0.05, 5.5);

  // Step 8: Poisson simulation
  const sim = runPoissonSimulation(xgHome, xgAway, isKnockout);

  // Normalize
  const [homeWinPct, drawPct, awayWinPct] = normalizePercentages([
    sim.homeWinPct, sim.drawPct, sim.awayWinPct,
  ]);

  // Step 9: Confidence
  const confidence = computeConfidence(match, 1);

  // Reasoning
  const reasoningParts = [
    match.minute ? `min ${match.minute}' ${homeScore}-${awayScore}` : "pre-match",
    scoreState.description,
    `dominance ${dominanceIndex}`,
    `momentum ${momentum > 0 ? "+" : ""}${momentum}`,
    `xG ${xgHome.toFixed(2)} vs ${xgAway.toFixed(2)}`,
    momentumDesc !== "neutral" ? momentumDesc : "",
  ].filter(Boolean) as string[];

  return {
    matchId: match.id,
    homeWinPct, drawPct, awayWinPct,
    regularTimeDecisionPct: sim.regularTimeDecisionPct,
    extraTimePct: sim.extraTimePct,
    penaltiesPct: sim.penaltiesPct,
    confidence,
    reasoningShort: reasoningParts.join(". ") + ".",
    dataFreshness: "Quantitative model",
    disclaimer: DISCLAIMER,
    estimateSource: "heuristic" as const,
    dominanceIndex,
    momentum,
  };
}

// ══════════════════════════════════════════════════════════════
// STEP 10: LLM INTERPRETATION LAYER
// ══════════════════════════════════════════════════════════════

function getPredictionInput(match: Match, heuristic: ReturnType<typeof buildHeuristicPrediction>) {
  return {
    matchId: match.id,
    competition: "FIFA World Cup 2026",
    stage: match.stage,
    group: match.group ?? null,
    status: match.status,
    minute: match.minute ?? null,
    score: { home: match.homeScore, away: match.awayScore },
    modelOutput: {
      homeWin: heuristic.homeWinPct,
      draw: heuristic.drawPct,
      awayWin: heuristic.awayWinPct,
      regularTimeDecision: heuristic.regularTimeDecisionPct ?? null,
      extraTime: heuristic.extraTimePct ?? null,
      penalties: heuristic.penaltiesPct ?? null,
      confidence: heuristic.confidence,
      dominanceIndex: (heuristic as any).dominanceIndex ?? 0,
      momentum: (heuristic as any).momentum ?? 0,
    },
    reasoningFromModel: heuristic.reasoningShort,
  };
}

async function fetchOpenAiPrediction(
  match: Match,
  heuristic: ReturnType<typeof buildHeuristicPrediction>,
) {
  if (!process.env.OPENAI_API_KEY) return null;
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const input = getPredictionInput(match, heuristic);

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
    console.warn(`OpenAI prediction failed ${response.status}: ${errorText}`);
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

function applyLlmCalibration(
  heuristic: ReturnType<typeof buildHeuristicPrediction>,
  llmResult: Partial<Prediction> | null,
): Prediction {
  if (!llmResult) {
    return {
      matchId: heuristic.matchId,
      homeWinPct: heuristic.homeWinPct,
      drawPct: heuristic.drawPct,
      awayWinPct: heuristic.awayWinPct,
      regularTimeDecisionPct: heuristic.regularTimeDecisionPct,
      extraTimePct: heuristic.extraTimePct,
      penaltiesPct: heuristic.penaltiesPct,
      confidence: heuristic.confidence,
      reasoningShort: heuristic.reasoningShort,
      dataFreshness: heuristic.dataFreshness,
      disclaimer: DISCLAIMER,
      estimateSource: "heuristic",
    };
  }

  const hw = safePct(toNumber(llmResult.homeWinPct ?? heuristic.homeWinPct));
  const dw = safePct(toNumber(llmResult.drawPct ?? heuristic.drawPct));
  const aw = safePct(toNumber(llmResult.awayWinPct ?? heuristic.awayWinPct));

  const [homeWinPct, drawPct, awayWinPct] = normalizePercentages([hw, dw, aw]);

  return {
    matchId: heuristic.matchId,
    homeWinPct, drawPct, awayWinPct,
    regularTimeDecisionPct: llmResult.regularTimeDecisionPct ?? heuristic.regularTimeDecisionPct,
    extraTimePct: llmResult.extraTimePct ?? heuristic.extraTimePct,
    penaltiesPct: llmResult.penaltiesPct ?? heuristic.penaltiesPct,
    confidence: (llmResult.confidence as any) ?? heuristic.confidence,
    reasoningShort: llmResult.reasoningShort?.trim() ?? heuristic.reasoningShort,
    dataFreshness: "AI-calibrated quantitative model",
    disclaimer: llmResult.disclaimer?.trim() ?? DISCLAIMER,
    estimateSource: llmResult ? "openai-blended" : "heuristic",
  };
}

// ══════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════

export async function getPredictionForMatch(match: Match) {
  return getCachedValue(`prediction:${match.id}`, PREDICTION_TTL_MS, async () => {
    try {
      const snapshot = await import("@/lib/providers/combinedProvider").then(m =>
        m.getDashboardSnapshot()
      );
      const allGroupMatches = snapshot.matches.filter(m => m.group === match.group);
      const allStandings = snapshot.standings.map(s => ({
        group: s.group,
        rows: s.rows.map(r => ({ code: r.team.code, points: r.points, played: r.played })),
      }));

      const heuristic = buildHeuristicPrediction(match, allGroupMatches, allStandings);
      const llmResult = await fetchOpenAiPrediction(match, heuristic);
      const final = applyLlmCalibration(heuristic, llmResult);

      setCachedValue(`prediction:${match.id}`, final, PREDICTION_TTL_MS);
      return final;
    } catch (error) {
      console.warn("Prediction failed:", error);
      return buildHeuristicPrediction(match, [], []) as unknown as Prediction;
    }
  });
}

export async function getPredictionsForMatches(matches: Match[]) {
  return Promise.all(matches.map((match) => getPredictionForMatch(match)));
}
