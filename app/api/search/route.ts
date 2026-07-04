import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q");
  if (!q) return NextResponse.json({ result: [] });
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return NextResponse.json({ error: "FINNHUB_API_KEY not set" }, { status: 500 });

  const r = await fetch(
    `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${key}`,
    { cache: "no-store" }
  );
  if (!r.ok) return NextResponse.json({ error: "upstream " + r.status }, { status: 502 });
  const d = await r.json();
  const result = (d.result || [])
    .slice(0, 20)
    .map((x: any) => ({ symbol: x.symbol, description: x.description, type: x.type }));
  return NextResponse.json({ result });
}
