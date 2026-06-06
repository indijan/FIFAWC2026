import fallbackData from "@/data/worldcup-2026-fallback.json";
import { getFallbackGroups, getTeamSeedByCode, resolveTeamReference, toTeamFromSeed } from "@/lib/team-metadata";
import {
  DashboardSnapshot,
  GroupStanding,
  HeadToHeadResult,
  Match,
  MatchStage,
  StandingRow,
  Team,
} from "@/lib/types";
import { getFreshnessLabel } from "@/lib/utils";

type KnockoutTemplate = {
  id: string;
  stage: MatchStage;
  homeRef: string;
  awayRef: string;
  kickoff: string;
};

function createPlaceholderTeam(code: string): Team {
  const mappedTeam = getTeamSeedByCode(code);

  if (mappedTeam) {
    return toTeamFromSeed(mappedTeam);
  }

  if (/^[A-L][1-4]$/.test(code)) {
    return {
      id: code,
      name: `Group ${code[0]} Seed ${code[1]}`,
      code,
      flagEmoji: "🏳️",
    };
  }

  return {
    id: code,
    name: code,
    code,
    flagEmoji: "🏳️",
  };
}

function getTeamMap() {
  return getFallbackGroups().reduce<Record<string, Team>>((accumulator, group) => {
    for (const team of group.teams) {
      accumulator[team.code] = toTeamFromSeed(team);
    }

    for (let seed = 1; seed <= 4; seed += 1) {
      const standingRef = `${group.id}${seed}`;
      const seededTeam = group.teams[seed - 1];

      accumulator[standingRef] = seededTeam
        ? toTeamFromSeed(seededTeam)
        : createPlaceholderTeam(standingRef);
    }

    return accumulator;
  }, {});
}

function resolveTeam(code: string, teamMap: Record<string, Team>) {
  return teamMap[code] ?? resolveTeamReference(code);
}

function buildGroupFixtures(teamMap: Record<string, Team>) {
  const pairings = [
    [0, 1],
    [2, 3],
    [0, 2],
    [1, 3],
    [0, 3],
    [1, 2],
  ] as const;

  return getFallbackGroups().flatMap<Match>((group, groupIndex) =>
    pairings.map(([homeIndex, awayIndex], matchIndex) => {
      const kickoff = new Date(
        Date.UTC(2026, 5, 11 + groupIndex + Math.floor(matchIndex / 2), 16 + (matchIndex % 2) * 3),
      );
      const homeCode = group.teams[homeIndex]?.code ?? `${group.id}${homeIndex + 1}`;
      const awayCode = group.teams[awayIndex]?.code ?? `${group.id}${awayIndex + 1}`;

      return {
        id: `fallback-${group.id}-${matchIndex + 1}`,
        homeTeam: resolveTeam(homeCode, teamMap),
        awayTeam: resolveTeam(awayCode, teamMap),
        kickoff: kickoff.toISOString(),
        status: "upcoming",
        stage: "Group Stage",
        group: group.id,
        venue: `Group ${group.id} venue`,
        source: "fallback-json",
      };
    }),
  );
}

function buildHeadToHeadForGroup(group: string, matches: Match[]) {
  return matches
    .filter((match) => match.group === group)
    .map<HeadToHeadResult>((match) => ({
      id: match.id,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      kickoff: match.kickoff,
      status: match.status,
      stage: match.stage,
      group: match.group,
    }));
}

function buildStandings(teamMap: Record<string, Team>, matches: Match[]) {
  return getFallbackGroups().map<GroupStanding>((group) => {
    const headToHead = buildHeadToHeadForGroup(group.id, matches);

    const rows = Array.from({ length: 4 }, (_, index) => {
      const team = group.teams[index];
      const teamCode = team?.code ?? `${group.id}${index + 1}`;

      return {
        rank: index + 1,
        team: resolveTeam(teamCode, teamMap),
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
        headToHeadResults: headToHead.filter(
          (match) => match.homeTeam.code === teamCode || match.awayTeam.code === teamCode,
        ),
      } satisfies StandingRow;
    });

    return {
      group: group.id,
      rows,
    };
  });
}

function buildKnockoutMatches(teamMap: Record<string, Team>) {
  return (fallbackData.knockoutTemplates as KnockoutTemplate[]).map<Match>((template) => ({
    id: template.id,
    stage: template.stage,
    kickoff: template.kickoff,
    status: "upcoming",
    homeTeam: resolveTeam(template.homeRef, teamMap),
    awayTeam: resolveTeam(template.awayRef, teamMap),
    venue: "World Cup Knockout Venue",
    source: "fallback-json",
  }));
}

export function getFallbackSnapshot(): DashboardSnapshot {
  const teamMap = getTeamMap();
  const matches = buildGroupFixtures(teamMap);
  const standings = buildStandings(teamMap, matches);
  const knockout = buildKnockoutMatches(teamMap);

  return {
    matches,
    standings,
    knockout,
    source: "fallback-json",
    generatedAt: fallbackData.generatedAt,
    freshnessLabel: getFreshnessLabel(fallbackData.generatedAt),
  };
}
