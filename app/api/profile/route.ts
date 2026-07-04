import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return NextResponse.json({ error: "FINNHUB_API_KEY not set" }, { status: 500 });

  const r = await fetch(
    `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${key}`,
    { next: { revalidate: 86400 } }
  );
  if (!r.ok) return NextResponse.json({ logo: "", name: "" });
  const d = await r.json();
  return NextResponse.json({ logo: d.logo || "", name: d.name || "" });
}
