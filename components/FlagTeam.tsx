import { Team } from "@/lib/types";

const FLAG_CDN = "https://flagcdn.com/w80";

const FIFA_TO_ISO: Record<string, string> = {
  MEX: "mx", RSA: "za", KOR: "kr", CZE: "cz", CAN: "ca", SUI: "ch",
  QAT: "qa", BIH: "ba", BRA: "br", MAR: "ma", SCO: "gb-sct", HAI: "ht",
  USA: "us", PAR: "py", AUS: "au", TUR: "tr", GER: "de", CUW: "cw",
  CIV: "ci", ECU: "ec", NED: "nl", JPN: "jp", TUN: "tn", SWE: "se",
  BEL: "be", EGY: "eg", IRN: "ir", NZL: "nz", ESP: "es", CPV: "cv",
  KSA: "sa", URU: "uy", FRA: "fr", SEN: "sn", NOR: "no", IRQ: "iq",
  ARG: "ar", ALG: "dz", AUT: "at", JOR: "jo", POR: "pt", UZB: "uz",
  COL: "co", COD: "cd", ENG: "gb-eng", CRO: "hr", GHA: "gh", PAN: "pa",
};

export function FlagTeam({ team, compact = false }: { team: Team; compact?: boolean }) {
  const iso = FIFA_TO_ISO[team.code.toUpperCase()] ?? team.code.slice(0, 2).toLowerCase();
  const flagSrc = `${FLAG_CDN}/${iso}.png`;
  const size = compact ? "h-4 w-6" : "h-6 w-9";

  return (
    <div className={`flex items-center gap-2 ${compact ? "text-sm" : ""}`}>
      <img
        className={`${size} rounded-sm object-cover shadow-sm`}
        src={flagSrc}
        alt={team.name}
        loading="lazy"
      />
      <div className="min-w-0">
        <div className="truncate font-medium text-ink">{team.name}</div>
        {!compact ? <div className="text-xs uppercase tracking-[0.18em] text-mist">{team.code}</div> : null}
      </div>
    </div>
  );
}

