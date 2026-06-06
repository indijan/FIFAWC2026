import { DashboardShell } from "@/components/DashboardShell";
import { getPredictionsForMatches } from "@/lib/predictions";
import { getDashboardSnapshot } from "@/lib/providers/combinedProvider";
import { buildPredictionLookup, getFeaturedMatches } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Page() {
  const snapshot = await getDashboardSnapshot();
  const featuredMatches = getFeaturedMatches(snapshot.matches);
  const knockoutPreview = snapshot.knockout.slice(0, 6);
  const predictions = await getPredictionsForMatches([...featuredMatches, ...knockoutPreview]);

  return (
    <DashboardShell
      initialSnapshot={snapshot}
      initialPredictions={buildPredictionLookup(predictions)}
    />
  );
}
