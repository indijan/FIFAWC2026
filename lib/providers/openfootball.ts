import { countryCodeToFlagEmoji } from "@/lib/flags";
import { resolveTeamReference } from "@/lib/team-metadata";
import { Match, MatchStage, MatchStatus, ProviderSnapshot, Team } from "@/lib/types";
import { fetchJson } from "@/lib/utils";

type OpenFootballMatch = {
  id?: string | number;
  home_team?: Record<string, unknown> | string;
  homeTeam?: Record<string, unknown> | string;
  team1?: Record<string, unknown> | string;
  home?: Record<string, unknown> | string;
  away_team?: Record<string, unknown> | string;
  awayTeam?: Record<string, unknown> | string;
  team2?: Record<string, unknown> | string;
  away?: Record<string, unknown> | string;
  date?: string;
  utcDate?: string;
  time?: string;
  kickoff?: string;
  status?: string;
  round?: string;
  stage?: string;
  group?: string;
  ground?: string;
  city?: string;
  venue?: string;
  score?: {
    home?: number;
    away?: number;
    ft?: [number, number];
  };
  result?: {
    home?: number;
    away?: number;
    ft?: [number, number];
  };
};

type OpenFootballPayload = {
  matches?: OpenFootballMatch[];
} | OpenFootballMatch[];

const OPENFOOTBALL_URLS = [
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json",
];

function normalizeStatus(status?: string): MatchStatus {
  const normalized = status?.toLowerCase() ?? "";

  if (normalized.includes("live") || normalized.includes("in play")) {
    return "live";
  }

  if (normalized.includes("half")) {
    return "halftime";
  }

  if (normalized.includes("finish") || normalized.includes("full")) {
    return "finished";
  }

  return "upcoming";
}

function buildTeam(raw: Record<string, unknown> | string | undefined | null, fallbackId: string): Team {
  if (typeof raw === "string") {
    return resolveTeamReference(raw);
  }

  const code = String(raw?.code ?? raw?.tla ?? raw?.fifa_code ?? fallbackId).toUpperCase();
  const name = String(raw?.name ?? raw?.title ?? fallbackId);
  const resolved = resolveTeamReference(name);

  if (resolved.flagEmoji !== "🏳️") {
    return resolved;
  }

  return {
    id: code,
    name,
    code,
    flagEmoji: countryCodeToFlagEmoji(code),
  };
}

function buildKickoff(dateValue: string, timeValue?: string) {
  if (!timeValue) {
    return `${dateValue}T18:00:00.000Z`;
  }

  const parts = timeValue.match(/^(\d{1,2}):(\d{2})(?:\s*UTC([+-]\d{1,2}))?$/i);

  if (!parts) {
    return `${dateValue}T${timeValue.replace(" ", "")}:00`;
  }

  const [, hourText, minuteText, offsetText] = parts;
  const offsetHours = offsetText ? Number(offsetText) : 0;
  const utcTime = Date.UTC(
    Number(dateValue.slice(0, 4)),
    Number(dateValue.slice(5, 7)) - 1,
    Number(dateValue.slice(8, 10)),
    Number(hourText) - offsetHours,
    Number(minuteText),
  );

  return new Date(utcTime).toISOString();
}

function normalizeStage(round?: string): MatchStage {
  const value = (round ?? "").toLowerCase();

  if (value.includes("round of 32")) {
    return "Round of 32";
  }

  if (value.includes("round of 16")) {
    return "Round of 16";
  }

  if (value.includes("quarter")) {
    return "Quarterfinal";
  }

  if (value.includes("semi")) {
    return "Semifinal";
  }

  if (value.includes("third")) {
    return "Third-place Match";
  }

  if (value.includes("final")) {
    return "Final";
  }

  return "Group Stage";
}

function normalizeMatch(raw: OpenFootballMatch, index: number): Match | null {
  const homeRaw = (raw.home_team ?? raw.homeTeam ?? raw.team1 ?? raw.home) as
    | Record<string, unknown>
    | string
    | undefined;
  const awayRaw = (raw.away_team ?? raw.awayTeam ?? raw.team2 ?? raw.away) as
    | Record<string, unknown>
    | string
    | undefined;

  if (!homeRaw || !awayRaw) {
    return null;
  }

  const dateValue = String(raw.date ?? raw.utcDate ?? "").trim();
  const timeValue =
    typeof raw.time === "string"
      ? raw.time
      : typeof raw.kickoff === "string"
        ? raw.kickoff
        : undefined;

  if (!dateValue) {
    return null;
  }

  const score = (raw.score ?? raw.result) as
    | {
        home?: number;
        away?: number;
        ft?: [number, number];
      }
    | undefined;

  return {
    id: String(raw.id ?? `openfootball-${index}`),
    homeTeam: buildTeam(homeRaw, `OFH${index}`),
    awayTeam: buildTeam(awayRaw, `OFA${index}`),
    kickoff: buildKickoff(dateValue, timeValue),
    status: normalizeStatus(typeof raw.status === "string" ? raw.status : undefined),
    homeScore:
      Array.isArray(score?.ft) && typeof score.ft[0] === "number"
        ? score.ft[0]
        : typeof score?.home === "number"
          ? score.home
          : undefined,
    awayScore:
      Array.isArray(score?.ft) && typeof score.ft[1] === "number"
        ? score.ft[1]
        : typeof score?.away === "number"
          ? score.away
          : undefined,
    stage: normalizeStage(typeof raw.round === "string" ? raw.round : typeof raw.stage === "string" ? raw.stage : undefined),
    group:
      typeof raw.group === "string"
        ? raw.group.replace("Group ", "")
        : typeof raw.round === "string" && raw.round.startsWith("Group ")
          ? raw.round.replace("Group ", "")
          : undefined,
    venue:
      typeof raw.ground === "string"
        ? raw.ground
        : typeof raw.city === "string"
          ? raw.city
          : typeof raw.venue === "string"
            ? raw.venue
            : undefined,
    source: "openfootball",
  };
}

export async function getOpenFootballSnapshot(): Promise<ProviderSnapshot | null> {
  for (const url of OPENFOOTBALL_URLS) {
    try {
      const payload = await fetchJson<OpenFootballPayload>(url);
      const rawMatches: OpenFootballMatch[] = Array.isArray(payload) ? payload : (payload.matches ?? []);
      const matches = rawMatches
        .map((entry, index) =>
          typeof entry === "object" && entry !== null
            ? normalizeMatch(entry, index)
            : null,
        )
        .filter((match): match is Match => Boolean(match));

      if (matches.length > 0) {
        return {
          matches,
          source: "openfootball",
          generatedAt: new Date().toISOString(),
        };
      }
    } catch (error) {
      console.error("OpenFootball provider failed:", error);
    }
  }

  return null;
}
