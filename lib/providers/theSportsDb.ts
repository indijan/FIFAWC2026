import { countryCodeToFlagEmoji } from "@/lib/flags";
import { Match, ProviderSnapshot, Team } from "@/lib/types";
import { fetchJson } from "@/lib/utils";

type TheSportsDbEvent = {
  idEvent?: string;
  strHomeTeam?: string;
  strAwayTeam?: string;
  dateEvent?: string;
  strTime?: string;
  intHomeScore?: string;
  intAwayScore?: string;
  strStatus?: string;
  strVenue?: string;
};

function toTeam(name: string, fallback: string): Team {
  const code = fallback.slice(0, 3).toUpperCase();

  return {
    id: code,
    name,
    code,
    flagEmoji: countryCodeToFlagEmoji(code),
  };
}

function normalizeStatus(status?: string) {
  const value = status?.toLowerCase() ?? "";

  if (value.includes("live")) {
    return "live" as const;
  }

  if (value.includes("half")) {
    return "halftime" as const;
  }

  if (value.includes("finished") || value.includes("ft")) {
    return "finished" as const;
  }

  return "upcoming" as const;
}

export async function getTheSportsDbSnapshot(): Promise<ProviderSnapshot | null> {
  const apiKey = process.env.THESPORTSDB_API_KEY || "123";

  try {
    const payload = await fetchJson<{ events?: TheSportsDbEvent[] }>(
      `https://www.thesportsdb.com/api/v1/json/${apiKey}/eventsseason.php?id=4424&s=2026`,
    );

    const matches =
      payload.events?.map<Match>((event, index) => ({
        id: event.idEvent || `thesportsdb-${index}`,
        homeTeam: toTeam(event.strHomeTeam || "Home", `home-${index}`),
        awayTeam: toTeam(event.strAwayTeam || "Away", `away-${index}`),
        kickoff: `${event.dateEvent || "2026-06-11"}T${event.strTime || "18:00:00"}Z`,
        status: normalizeStatus(event.strStatus),
        homeScore: event.intHomeScore ? Number(event.intHomeScore) : undefined,
        awayScore: event.intAwayScore ? Number(event.intAwayScore) : undefined,
        stage: "Group Stage",
        venue: event.strVenue || undefined,
        source: "thesportsdb",
      })) ?? [];

    if (matches.length === 0) {
      return null;
    }

    return {
      matches,
      source: "thesportsdb",
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("TheSportsDB provider failed:", error);
    return null;
  }
}
