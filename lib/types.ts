export type MatchStatus = "upcoming" | "live" | "halftime" | "finished";

export type MatchStage =
  | "Group Stage"
  | "Round of 32"
  | "Round of 16"
  | "Quarterfinal"
  | "Semifinal"
  | "Third-place Match"
  | "Final";

export interface Team {
  id: string;
  name: string;
  code: string;
  flagEmoji: string;
  flagUrl?: string;
  ranking?: number;
  elo?: number;
}

export interface MatchEvent {
  minute?: number;
  teamId?: string;
  type: string;
  player?: string;
  detail?: string;
}

export interface MatchStatPair {
  home?: number;
  away?: number;
}

export interface MatchStats {
  shots?: MatchStatPair;
  shotsOnTarget?: MatchStatPair;
  possession?: MatchStatPair;
  xg?: MatchStatPair;
  corners?: MatchStatPair;
  fouls?: MatchStatPair;
  yellowCards?: MatchStatPair;
  redCards?: MatchStatPair;
  substitutions?: MatchStatPair;
  dangerousAttacks?: MatchStatPair;
  totalPasses?: MatchStatPair;
  passesAccurate?: MatchStatPair;
  goalkeeperSaves?: MatchStatPair;
}

export interface Match {
  id: string;
  homeTeam: Team;
  awayTeam: Team;
  kickoff: string;
  status: MatchStatus;
  minute?: number;
  homeScore?: number;
  awayScore?: number;
  stage: MatchStage;
  group?: string;
  venue?: string;
  venueLat?: number;
  venueLon?: number;
  events?: MatchEvent[];
  stats?: MatchStats;
  source?: string;
}

export interface HeadToHeadResult {
  id: string;
  homeTeam: Team;
  awayTeam: Team;
  homeScore?: number;
  awayScore?: number;
  status: MatchStatus;
  kickoff: string;
  stage: MatchStage;
  group?: string;
}

export interface StandingRow {
  rank: number;
  team: Team;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  headToHeadResults: HeadToHeadResult[];
}

export interface GroupStanding {
  group: string;
  rows: StandingRow[];
}

export interface Prediction {
  matchId: string;
  homeWinPct: number;
  drawPct: number;
  awayWinPct: number;
  regularTimeDecisionPct?: number;
  extraTimePct?: number;
  penaltiesPct?: number;
  confidence: "low" | "medium" | "high";
  reasoningShort: string;
  dataFreshness: string;
  disclaimer: string;
  estimateSource?: "heuristic" | "openai" | "openai-blended";
}

export interface DashboardSnapshot {
  matches: Match[];
  standings: GroupStanding[];
  knockout: Match[];
  source: string;
  generatedAt: string;
  freshnessLabel: string;
}

export interface ProviderSnapshot {
  matches?: Match[];
  standings?: GroupStanding[];
  knockout?: Match[];
  source: string;
  generatedAt: string;
}
