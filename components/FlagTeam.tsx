import { Team } from "@/lib/types";

export function FlagTeam({ team, compact = false }: { team: Team; compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${compact ? "text-sm" : ""}`}>
      <span className="text-xl leading-none">{team.flagEmoji}</span>
      <div className="min-w-0">
        <div className="truncate font-medium text-ink">{team.name}</div>
        {!compact ? <div className="text-xs uppercase tracking-[0.18em] text-mist">{team.code}</div> : null}
      </div>
    </div>
  );
}

