import { countryCodeToFlagEmoji } from "@/lib/flags";
import { GroupStanding, Match, MatchStage, MatchStats, ProviderSnapshot, StandingRow, Team } from "@/lib/types";
import { fetchJson } from "@/lib/utils";

type ApiSportsFixture = {
  fixture: {
    id: number;
    date: string;
    status: {
      short: string;
      elapsed?: number;
    };
    venue?: {
      name?: string;
    };
  };
  league: {
    round?: string;
  };
  teams: {
    home: {
      id?: number;
      name?: string;
      code?: string;
    };
    away: {
      id?: number;
      name?: string;
      code?: string;
    };
  };
  goals: {
    home?: number | null;
    away?: number | null;
  };
  statistics?: Array<{
    team?: { id?: number };
    statistics?: Array<{
      type: string;
      value: number | string | null;
    }>;
  }>;
};

function toTeam(raw: { id?: number; name?: string; code?: string }, fallback: string): Team {
  const code = raw.code || fallback.slice(0, 3).toUpperCase();

  return {
    id: String(raw.id ?? code),
    name: raw.name || fallback,
    code,
    flagEmoji: countryCodeToFlagEmoji(code),
  };
}

function normalizeStageFromApiSports(round?: string): MatchStage {
  if (!round) return "Group Stage";

  const value = round.toLowerCase();

  if (value.includes("group")) return "Group Stage";
  if (value.includes("round of 32") || value.includes("round 1") || value.includes("first round")) return "Round of 32";
  if (value.includes("round of 16") || value.includes("round 2") || value.includes("second round")) return "Round of 16";
  if (value.includes("quarter")) return "Quarterfinal";
  if (value.includes("semi")) return "Semifinal";
  if (value.includes("third") || value.includes("3rd place")) return "Third-place Match";
  if (value.includes("final")) return "Final";

  return "Round of 32";
}

function statusFromApiSports(short: string) {
  if (["1H", "2H", "ET", "P"].includes(short)) {
    return "live" as const;
  }

  if (["HT", "BT"].includes(short)) {
    return "halftime" as const;
  }

  if (["FT", "AET", "PEN"].includes(short)) {
    return "finished" as const;
  }

  return "upcoming" as const;
}

function statValue(
  statistics: ApiSportsFixture["statistics"] | undefined,
  teamId: number | undefined,
  statType: string,
) {
  const teamStats = statistics?.find((entry) => entry.team?.id === teamId)?.statistics;
  const rawValue = teamStats?.find((entry) => entry.type === statType)?.value;

  if (typeof rawValue === "number") {
    return rawValue;
  }

  if (typeof rawValue === "string") {
    const numericValue = Number(rawValue.replace("%", "").trim());
    return Number.isFinite(numericValue) ? numericValue : undefined;
  }

  return undefined;
}

function getStats(fixture: ApiSportsFixture): MatchStats | undefined {
  if (!fixture.statistics || fixture.statistics.length === 0) {
    return undefined;
  }

  const homeId = fixture.teams.home.id;
  const awayId = fixture.teams.away.id;

  return {
    shots: {
      home: statValue(fixture.statistics, homeId, "Total Shots"),
      away: statValue(fixture.statistics, awayId, "Total Shots"),
    },
    shotsOnTarget: {
      home: statValue(fixture.statistics, homeId, "Shots on Goal"),
      away: statValue(fixture.statistics, awayId, "Shots on Goal"),
    },
    possession: {
      home: statValue(fixture.statistics, homeId, "Ball Possession"),
      away: statValue(fixture.statistics, awayId, "Ball Possession"),
    },
    corners: {
      home: statValue(fixture.statistics, homeId, "Corner Kicks"),
      away: statValue(fixture.statistics, awayId, "Corner Kicks"),
    },
    fouls: {
      home: statValue(fixture.statistics, homeId, "Fouls"),
      away: statValue(fixture.statistics, awayId, "Fouls"),
    },
    yellowCards: {
      home: statValue(fixture.statistics, homeId, "Yellow Cards"),
      away: statValue(fixture.statistics, awayId, "Yellow Cards"),
    },
    redCards: {
      home: statValue(fixture.statistics, homeId, "Red Cards"),
      away: statValue(fixture.statistics, awayId, "Red Cards"),
    },
    dangerousAttacks: {
      home: statValue(fixture.statistics, homeId, "Dangerous Attacks"),
      away: statValue(fixture.statistics, awayId, "Dangerous Attacks"),
    },
    totalPasses: {
      home: statValue(fixture.statistics, homeId, "Total passes"),
      away: statValue(fixture.statistics, awayId, "Total passes"),
    },
    passesAccurate: {
      home: statValue(fixture.statistics, homeId, "Passes accurate"),
      away: statValue(fixture.statistics, awayId, "Passes accurate"),
    },
    goalkeeperSaves: {
      home: statValue(fixture.statistics, homeId, "Goalkeeper saves"),
      away: statValue(fixture.statistics, awayId, "Goalkeeper saves"),
    },
  };
}

export async function getApiSportsSnapshot(): Promise<ProviderSnapshot | null> {
  if (!process.env.APISPORTS_API_KEY) {
    return null;
  }

  try {
    const headers = {
      "x-apisports-key": process.env.APISPORTS_API_KEY,
    };

    const [fixturesPayload, standingsPayload] = await Promise.all([
      fetchJson<{ response?: ApiSportsFixture[] }>(
        "https://v3.football.api-sports.io/fixtures?league=1&season=2026",
        { headers },
      ),
      fetchJson<{
        response?: Array<{
          league?: {
            standings?: Array<
              Array<{
                rank: number;
                team: { id?: number; name?: string; code?: string };
                all: {
                  played: number;
                  win: number;
                  draw: number;
                  lose: number;
                  goals: {
                    for: number;
                    against: number;
                  };
                };
                goalsDiff: number;
                points: number;
                group?: string;
              }>
            >;
          };
        }>;
      }>("https://v3.football.api-sports.io/standings?league=1&season=2026", { headers }),
    ]);

    const matches =
      fixturesPayload.response?.map<Match>((fixture) => ({
        id: String(fixture.fixture.id),
        homeTeam: toTeam(fixture.teams.home, "Home"),
        awayTeam: toTeam(fixture.teams.away, "Away"),
        kickoff: fixture.fixture.date,
        status: statusFromApiSports(fixture.fixture.status.short),
        minute: fixture.fixture.status.elapsed,
        homeScore: fixture.goals.home ?? undefined,
        awayScore: fixture.goals.away ?? undefined,
        stage: normalizeStageFromApiSports(fixture.league.round),
        group: fixture.league.round?.startsWith("Group") ? fixture.league.round.split(" - ").at(-1) : undefined,
        venue: fixture.fixture.venue?.name,
        stats: getStats(fixture),
        source: "api-sports",
      })) ?? [];

    const rawStandingGroups = standingsPayload.response?.[0]?.league?.standings ?? [];
    const standings = rawStandingGroups.map<GroupStanding>((groupRows) => ({
      group: groupRows[0]?.group?.split(":").at(-1)?.trim() || "?",
      rows: groupRows.map<StandingRow>((row) => ({
        rank: row.rank,
        team: toTeam(row.team, row.team.name || "TBD"),
        played: row.all.played,
        won: row.all.win,
        drawn: row.all.draw,
        lost: row.all.lose,
        goalsFor: row.all.goals.for,
        goalsAgainst: row.all.goals.against,
        goalDifference: row.goalsDiff,
        points: row.points,
        headToHeadResults: [],
      })),
    }));

    if (matches.length === 0 && standings.length === 0) {
      return null;
    }

    return {
      matches,
      standings,
      source: "api-sports",
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("API-Sports provider failed:", error);
    return null;
  }
}

