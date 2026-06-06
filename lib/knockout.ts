import { GroupStanding, Match, Team } from "@/lib/types";

function placeholderTeam(name: string): Team {
  return {
    id: name,
    name,
    code: name,
    flagEmoji: "🏳️",
  };
}

function resolveStandingRef(reference: string, standings: GroupStanding[]) {
  const match = reference.match(/^([A-L])([1-4])$/);

  if (!match) {
    return placeholderTeam(reference);
  }

  const [, group, rankText] = match;
  const groupStanding = standings.find((entry) => entry.group === group);
  const rank = Number(rankText);

  return groupStanding?.rows[rank - 1]?.team ?? placeholderTeam(`Group ${group} Seed ${rank}`);
}

export function fillKnockoutPlaceholders(knockoutMatches: Match[], standings: GroupStanding[]) {
  return knockoutMatches.map((match) => ({
    ...match,
    homeTeam: resolveStandingRef(match.homeTeam.code, standings),
    awayTeam: resolveStandingRef(match.awayTeam.code, standings),
  }));
}

