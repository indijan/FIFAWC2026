import { NextRequest, NextResponse } from "next/server";

import { getPredictionForMatch } from "@/lib/predictions";
import { getMatchById } from "@/lib/providers/combinedProvider";
import { Match } from "@/lib/types";

async function resolveMatchFromRequest(request: NextRequest) {
  const matchId = request.nextUrl.searchParams.get("matchId");

  if (matchId) {
    return getMatchById(matchId);
  }

  try {
    const body = (await request.json()) as { match?: Match };
    return body.match ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const match = await resolveMatchFromRequest(request);

  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  const prediction = await getPredictionForMatch(match);
  return NextResponse.json(prediction);
}

export async function POST(request: NextRequest) {
  const match = await resolveMatchFromRequest(request);

  if (!match) {
    return NextResponse.json({ error: "Match payload missing" }, { status: 400 });
  }

  const prediction = await getPredictionForMatch(match);
  return NextResponse.json(prediction);
}

