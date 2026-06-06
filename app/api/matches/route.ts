import { NextResponse } from "next/server";

import { getDashboardSnapshot } from "@/lib/providers/combinedProvider";

export async function GET() {
  const snapshot = await getDashboardSnapshot();

  return NextResponse.json({
    generatedAt: snapshot.generatedAt,
    freshnessLabel: snapshot.freshnessLabel,
    source: snapshot.source,
    matches: snapshot.matches,
  });
}

