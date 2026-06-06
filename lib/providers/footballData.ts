import { countryCodeToFlagEmoji } from "@/lib/flags";
import { GroupStanding, Match, MatchStatus, ProviderSnapshot, StandingRow, Team } from "@/lib/types";
import { fetchJson } from "@/lib/utils";

type FootballDataTeam = {
  id?: number;
  name?: string;
  shortName?: string;
  tla?: string;
};

type FootballDataMatch = {
  id: number;
  utcDate: string;
  status: string;
  stage?: string;
  group?: string;
  venue?: string;
  minute?: number;
  homeTeam: FootballDataTeam;
  awayTeam: FootballDataTeam;
  score?: {
    fullTime?: {
      home?: number | null;
      away?: number | null;
    };
  };
};

type FootballDataStanding = {
  group?: string;
  table: Array<{
    position: number;
    won: number;
    draw: number;
    lost: number;
    playedGames: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
    points: number;
    team: FootballDataTeam;
  }>;
};

function statusFromFootballData(status: string): MatchStatus {
  switch (status) {
    case "LIVE":
    case "IN_PLAY":
      return "live";
    case "PAUSED":
      return "halftime";
    case "FINISHED":
      return "finished";
    default:
      return "upcoming";
  }
}

function toTeam(team: FootballDataTeam): Team {
  const code = team.tla || team.shortName?.slice(0, 3).toUpperCase() || String(team.id ?? team.name ?? "TBD");

  return {
    id: String(team.id ?? code),
    name: team.name || code,
    code,
    flagEmoji: countryCodeToFlagEmoji(code),
  };
}

function normalizeStage(stage?: string) {
  if (!stage || stage === "GROUP_STAGE") {
    return "Group Stage" as const;
  }

  if (stage === "LAST_16") {
    return "Round of 16" as const;
  }

  if (stage === "QUARTER_FINALS") {
    return "Quarterfinal" as const;
  }

  if (stage === "SEMI_FINALS") {
    return "Semifinal" as const;
  }

  if (stage === "THIRD_PLACE") {
    return "Third-place Match" as const;
  }

  if (stage === "FINAL") {
    return "Final" as const;
  }

  return "Round of 32" as const;
}

export async function getFootballDataSnapshot(): Promise<ProviderSnapshot | null> {
  if (!process.env.FOOTBALL_DATA_API_KEY) {
    return null;
  }

  try {
    const headers = {
      "X-Auth-Token": process.env.FOOTBALL_DATA_API_KEY,
    };

    const [matchesPayload, standingsPayload] = await Promise.all([
      fetchJson<{ matches?: FootballDataMatch[] }>(
        "https://api.football-data.org/v4/competitions/WC/matches",
        { headers },
      ),
      fetchJson<{ standings?: FootballDataStanding[] }>(
        "https://api.football-data.org/v4/competitions/WC/standings",
        { headers },
      ),
    ]);

    const matches =
      matchesPayload.matches?.map<Match>((match) => ({
        id: String(match.id),
        homeTeam: toTeam(match.homeTeam),
        awayTeam: toTeam(match.awayTeam),
        kickoff: match.utcDate,
        status: statusFromFootballData(match.status),
        minute: match.minute,
        homeScore: match.score?.fullTime?.home ?? undefined,
        awayScore: match.score?.fullTime?.away ?? undefined,
        stage: normalizeStage(match.stage),
        group: match.group?.replace("GROUP_", ""),
        venue: match.venue,
        source: "football-data",
      })) ?? [];

    const standings =
      standingsPayload.standings?.map<GroupStanding>((standing) => ({
        group: standing.group?.replace("GROUP_", "") || "?",
        rows: standing.table.map<StandingRow>((row) => ({
          rank: row.position,
          team: toTeam(row.team),
          played: row.playedGames,
          won: row.won,
          drawn: row.draw,
          lost: row.lost,
          goalsFor: row.goalsFor,
          goalsAgainst: row.goalsAgainst,
          goalDifference: row.goalDifference,
          points: row.points,
          headToHeadResults: [],
        })),
      })) ?? [];

    if (matches.length === 0 && standings.length === 0) {
      return null;
    }

    return {
      matches,
      standings,
      source: "football-data",
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("football-data provider failed:", error);
    return null;
  }
}

