import fallbackData from "@/data/worldcup-2026-fallback.json";
import { countryCodeToFlagEmoji } from "@/lib/flags";
import { Team } from "@/lib/types";

type TeamSeed = {
  name: string;
  code: string;
  ranking: number;
  aliases?: string[];
};

type GroupSeed = {
  id: string;
  teams: TeamSeed[];
};

const groups = fallbackData.groups as GroupSeed[];

const aliasToTeam = new Map<string, TeamSeed>();
const codeToTeam = new Map<string, TeamSeed>();

for (const group of groups) {
  for (const team of group.teams) {
    codeToTeam.set(team.code.toUpperCase(), team);
    aliasToTeam.set(team.name.trim().toLowerCase(), team);
    aliasToTeam.set(team.code.trim().toLowerCase(), team);

    for (const alias of team.aliases ?? []) {
      aliasToTeam.set(alias.trim().toLowerCase(), team);
    }
  }
}

function placeholderTeam(ref: string): Team {
  return {
    id: ref,
    name: ref,
    code: ref,
    flagEmoji: "🏳️",
  };
}

export function getFallbackGroups() {
  return groups;
}

export function getTeamSeedByCode(code: string) {
  return codeToTeam.get(code.toUpperCase());
}

export function getTeamSeedByNameOrCode(value: string) {
  return aliasToTeam.get(value.trim().toLowerCase());
}

export function toTeamFromSeed(seed: TeamSeed): Team {
  return {
    id: seed.code,
    name: seed.name,
    code: seed.code,
    flagEmoji: countryCodeToFlagEmoji(seed.code),
    ranking: seed.ranking,
  };
}

export function resolveTeamReference(value: string) {
  const seed = getTeamSeedByNameOrCode(value);
  return seed ? toTeamFromSeed(seed) : placeholderTeam(value);
}
