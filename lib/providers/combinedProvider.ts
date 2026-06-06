import { fillKnockoutPlaceholders } from "@/lib/knockout";
import { getCachedValue } from "@/lib/server-cache";
import { GroupStanding, Match, ProviderSnapshot, StandingRow, Team, DashboardSnapshot } from "@/lib/types";
import { getFreshnessLabel, sortMatches } from "@/lib/utils";
import { getApiSportsSnapshot } from "@/lib/providers/apiSports";
import { getFootballDataSnapshot } from "@/lib/providers/footballData";
import { getOpenFootballSnapshot } from "@/lib/providers/openfootball";
import { getTheSportsDbSnapshot } from "@/lib/providers/theSportsDb";

const SNAPSHOT_TTL_MS = 60_000;

function createEmptySnapshot(): DashboardSnapshot {
  const generatedAt = new Date().toISOString();

  return {
    matches: [],
    standings: [],
    knockout: [],
    source: "no-provider-data",
    generatedAt,
    freshnessLabel: getFreshnessLabel(generatedAt),
  };
}

function matchKey(match: Match) {
  return [
    match.stage,
    match.group ?? "",
    match.homeTeam.name.toLowerCase(),
    match.awayTeam.name.toLowerCase(),
    new Date(match.kickoff).toISOString().slice(0, 16),
  ].join("::");
}

function mergeMatches(baseMatches: Match[], incomingMatches: Match[]) {
  const merged = new Map<string, Match>();

  for (const match of [...baseMatches, ...incomingMatches]) {
    merged.set(matchKey(match), match);
  }

  return sortMatches(Array.from(merged.values()));
}

function mergeStandingRows(baseRows: StandingRow[], incomingRows: StandingRow[]) {
  const rows = incomingRows.length > 0 ? incomingRows : baseRows;
  return rows.slice().sort((left, right) => left.rank - right.rank);
}

function mergeStandings(baseStandings: GroupStanding[], incomingStandings: GroupStanding[]) {
  if (incomingStandings.length === 0) {
    return baseStandings;
  }

  const map = new Map<string, GroupStanding>();

  for (const standing of baseStandings) {
    map.set(standing.group, standing);
  }

  for (const standing of incomingStandings) {
    const existing = map.get(standing.group);
    map.set(standing.group, {
      group: standing.group,
      rows: mergeStandingRows(existing?.rows ?? [], standing.rows),
    });
  }

  return Array.from(map.values()).sort((left, right) => left.group.localeCompare(right.group));
}

function applyMatchToStandings(rows: StandingRow[], match: Match) {
  const homeRow = rows.find((row) => row.team.id === match.homeTeam.id || row.team.code === match.homeTeam.code);
  const awayRow = rows.find((row) => row.team.id === match.awayTeam.id || row.team.code === match.awayTeam.code);

  if (!homeRow || !awayRow) {
    return;
  }

  const homeGoals = match.homeScore ?? 0;
  const awayGoals = match.awayScore ?? 0;

  homeRow.played += 1;
  awayRow.played += 1;
  homeRow.goalsFor += homeGoals;
  homeRow.goalsAgainst += awayGoals;
  awayRow.goalsFor += awayGoals;
  awayRow.goalsAgainst += homeGoals;

  if (homeGoals > awayGoals) {
    homeRow.won += 1;
    awayRow.lost += 1;
    homeRow.points += 3;
  } else if (homeGoals < awayGoals) {
    awayRow.won += 1;
    homeRow.lost += 1;
    awayRow.points += 3;
  } else {
    homeRow.drawn += 1;
    awayRow.drawn += 1;
    homeRow.points += 1;
    awayRow.points += 1;
  }
}

function normalizeStandingRows(rows: StandingRow[], matches: Match[]) {
  const recalculated = rows.map<StandingRow>((row) => ({
    ...row,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    headToHeadResults: matches.map((match) => ({
      id: match.id,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
      kickoff: match.kickoff,
      stage: match.stage,
      group: match.group,
    })),
  }));

  for (const match of matches) {
    if (match.status === "upcoming" || match.homeScore === undefined || match.awayScore === undefined) {
      continue;
    }

    applyMatchToStandings(recalculated, match);
  }

  for (const row of recalculated) {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
  }

  return recalculated.sort((left, right) => {
    if (right.points !== left.points) {
      return right.points - left.points;
    }

    if (right.goalDifference !== left.goalDifference) {
      return right.goalDifference - left.goalDifference;
    }

    return right.goalsFor - left.goalsFor;
  }).map((row, index) => ({
    ...row,
    rank: index + 1,
  }));
}

function recalculateStandings(standings: GroupStanding[], matches: Match[]) {
  return standings.map<GroupStanding>((standing) => {
    const groupMatches = matches.filter((match) => match.group === standing.group);

    if (groupMatches.length === 0) {
      return standing;
    }

    return {
      group: standing.group,
      rows: normalizeStandingRows(standing.rows, groupMatches),
    };
  });
}

function mergeSnapshot(base: DashboardSnapshot, partial: ProviderSnapshot) {
  const mergedMatches =
    partial.matches && partial.matches.length >= base.matches.length
      ? sortMatches(partial.matches)
      : partial.matches
        ? mergeMatches(base.matches, partial.matches)
        : base.matches;

  return {
    ...base,
    matches: mergedMatches,
    standings: partial.standings ? mergeStandings(base.standings, partial.standings) : base.standings,
    knockout: partial.knockout ? mergeMatches(base.knockout, partial.knockout) : base.knockout,
    source: `${base.source} -> ${partial.source}`,
    generatedAt: partial.generatedAt,
  };
}

async function loadSnapshot() {
  let snapshot = createEmptySnapshot();
  const providers = [
    getOpenFootballSnapshot,
    getFootballDataSnapshot,
    getTheSportsDbSnapshot,
    getApiSportsSnapshot,
  ];

  for (const provider of providers) {
    try {
      const partial = await provider();

      if (partial) {
        snapshot = mergeSnapshot(snapshot, partial);
      }
    } catch (error) {
      console.error("Combined provider merge failed:", error);
    }
  }

  snapshot.standings = recalculateStandings(snapshot.standings, snapshot.matches);
  snapshot.knockout = fillKnockoutPlaceholders(snapshot.knockout, snapshot.standings);
  snapshot.matches = sortMatches(snapshot.matches);
  snapshot.knockout = sortMatches(snapshot.knockout);
  snapshot.freshnessLabel = getFreshnessLabel(snapshot.generatedAt);

  return snapshot;
}

export async function getDashboardSnapshot(forceRefresh = false) {
  if (forceRefresh) {
    return loadSnapshot();
  }

  return getCachedValue("dashboard-snapshot", SNAPSHOT_TTL_MS, loadSnapshot);
}

export async function getMatchById(matchId: string) {
  const snapshot = await getDashboardSnapshot();
  return [...snapshot.matches, ...snapshot.knockout].find((match) => match.id === matchId) ?? null;
}
