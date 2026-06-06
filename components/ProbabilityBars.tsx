import { Prediction } from "@/lib/types";

function Bar({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-mist">
        <span>{label}</span>
        <span className="font-mono text-ink">{value.toFixed(1)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/8">
        <div className={`h-full rounded-full ${accent}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function ProbabilityBars({
  prediction,
  knockout = false,
  homeLabel = "Home",
  awayLabel = "Away",
}: {
  prediction: Prediction;
  knockout?: boolean;
  homeLabel?: string;
  awayLabel?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Bar label={`${homeLabel} win`} value={prediction.homeWinPct} accent="bg-accent" />
        <Bar label="Draw" value={prediction.drawPct} accent="bg-gold" />
        <Bar label={`${awayLabel} win`} value={prediction.awayWinPct} accent="bg-danger" />
      </div>
      {knockout &&
      prediction.regularTimeDecisionPct !== undefined &&
      prediction.extraTimePct !== undefined &&
      prediction.penaltiesPct !== undefined ? (
        <div className="space-y-2 border-t border-white/10 pt-3">
          <Bar
            label="Regular-time decision"
            value={prediction.regularTimeDecisionPct}
            accent="bg-sky-400"
          />
          <Bar label="Extra time" value={prediction.extraTimePct} accent="bg-indigo-300" />
          <Bar label="Penalties" value={prediction.penaltiesPct} accent="bg-rose-300" />
        </div>
      ) : null}
    </div>
  );
}
