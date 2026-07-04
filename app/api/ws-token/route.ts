import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return NextResponse.json({ error: "FINNHUB_API_KEY not set" }, { status: 500 });
  return NextResponse.json({ token: key });
}
