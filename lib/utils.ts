import { Match, MatchStatus, Prediction } from "@/lib/types";

const MATCH_STATUS_RANK: Record<MatchStatus, number> = {
  live: 0,
  halftime: 1,
  upcoming: 2,
  finished: 3,
};

const AUCKLAND_TIMEZONE = "Pacific/Auckland";

export function formatKickoff(kickoff: string) {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: AUCKLAND_TIMEZONE,
    timeZoneName: "short",
  }).format(new Date(kickoff));
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function normalizePercentages(values: number[]) {
  const safeValues = values.map((value) => Math.max(0, value));
  const total = safeValues.reduce((sum, value) => sum + value, 0) || 1;
  const normalized = safeValues.map((value) => (value / total) * 100);
  const rounded = normalized.map((value) => Math.round(value * 10) / 10);
  const drift = Math.round((100 - rounded.reduce((sum, value) => sum + value, 0)) * 10) / 10;

  if (rounded.length > 0) {
    rounded[0] = Math.round((rounded[0] + drift) * 10) / 10;
  }

  return rounded;
}

export function sortMatches(matches: Match[]) {
  return [...matches].sort((left, right) => {
    const statusDelta = MATCH_STATUS_RANK[left.status] - MATCH_STATUS_RANK[right.status];

    if (statusDelta !== 0) {
      return statusDelta;
    }

    return new Date(left.kickoff).getTime() - new Date(right.kickoff).getTime();
  });
}

export function getFreshnessLabel(generatedAt: string) {
  const deltaMs = Date.now() - new Date(generatedAt).getTime();

  if (deltaMs < 90_000) {
    return "Updated moments ago";
  }

  if (deltaMs < 10 * 60_000) {
    return `Updated ${Math.round(deltaMs / 60_000)} min ago`;
  }

  return `Updated ${Math.round(deltaMs / 3_600_000)} hr ago`;
}

export function getFeaturedMatches(matches: Match[]) {
  const liveMatches = matches.filter((match) => match.status === "live" || match.status === "halftime");

  if (liveMatches.length > 0) {
    return sortMatches(liveMatches);
  }

  const upcomingMatches = matches.filter((match) => match.status === "upcoming");
  return sortMatches(upcomingMatches).slice(0, 6);
}

export function isKnockoutMatch(match: Match) {
  return match.stage !== "Group Stage";
}

export function buildPredictionLookup(predictions: Prediction[]) {
  return predictions.reduce<Record<string, Prediction>>((accumulator, prediction) => {
    accumulator[prediction.matchId] = prediction;
    return accumulator;
  }, {});
}

export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
      next: {
        revalidate: 600,
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function safeJsonParse<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
