import { FlagTeam } from "@/components/FlagTeam";
import { MatchStatusBadge } from "@/components/MatchStatusBadge";
import { GroupStanding } from "@/lib/types";
import { formatKickoff } from "@/lib/utils";

export function GroupTable({ standing }: { standing: GroupStanding }) {
  const headToHeadRows = Array.from(
    new Map(
      standing.rows
        .flatMap((row) => row.headToHeadResults)
        .map((match) => [match.id, match]),
    ).values(),
  );

  return (
    <section className="panel-surface rounded-3xl p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-display text-2xl text-ink">Group {standing.group}</h3>
        <span className="text-xs uppercase tracking-[0.18em] text-mist">
          Live table projection
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.16em] text-mist">
            <tr>
              <th className="pb-3 pr-4">#</th>
              <th className="pb-3 pr-4">Country</th>
              <th className="pb-3 pr-3">P</th>
              <th className="pb-3 pr-3">W</th>
              <th className="pb-3 pr-3">D</th>
              <th className="pb-3 pr-3">L</th>
              <th className="pb-3 pr-3">GF</th>
              <th className="pb-3 pr-3">GA</th>
              <th className="pb-3 pr-3">GD</th>
              <th className="pb-3">Pts</th>
            </tr>
          </thead>
          <tbody>
            {standing.rows.map((row) => (
              <tr key={row.team.id} className="border-t border-white/8 text-ink">
                <td className="py-3 pr-4 font-mono text-mist">{row.rank}</td>
                <td className="py-3 pr-4">
                  <FlagTeam team={row.team} compact />
                </td>
                <td className="py-3 pr-3 font-mono">{row.played}</td>
                <td className="py-3 pr-3 font-mono">{row.won}</td>
                <td className="py-3 pr-3 font-mono">{row.drawn}</td>
                <td className="py-3 pr-3 font-mono">{row.lost}</td>
                <td className="py-3 pr-3 font-mono">{row.goalsFor}</td>
                <td className="py-3 pr-3 font-mono">{row.goalsAgainst}</td>
                <td className="py-3 pr-3 font-mono">{row.goalDifference}</td>
                <td className="py-3 font-mono font-semibold">{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
        <div className="text-xs uppercase tracking-[0.16em] text-mist">Group fixtures</div>
        {headToHeadRows.length > 0 ? (
          headToHeadRows.map((match) => (
            <div
              key={match.id}
              className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/5 p-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-4">
                <FlagTeam team={match.homeTeam} compact />
                <div className="font-mono text-sm text-ink">
                  {match.homeScore !== undefined && match.awayScore !== undefined
                    ? `${match.homeScore} : ${match.awayScore}`
                    : "vs"}
                </div>
                <FlagTeam team={match.awayTeam} compact />
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-mist">
                <MatchStatusBadge status={match.status} />
                <span>{formatKickoff(match.kickoff)}</span>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-mist">No fixture rows available yet.</p>
        )}
      </div>
    </section>
  );
}

