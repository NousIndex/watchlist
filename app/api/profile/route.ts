import { NextResponse } from "next/server";
import { fetchYahooMeta } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // lib/yahoo.ts uses node:https

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return NextResponse.json({ error: "FINNHUB_API_KEY not set" }, { status: 500 });

  let logo = "";
  let name = "";
  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${key}`,
      { next: { revalidate: 86400 } }
    );
    if (r.ok) {
      const d = await r.json();
      logo = d.logo || "";
      name = d.name || "";
    }
  } catch {}

  // Finnhub's free profile2 covers US common stocks only — ETFs come back {}
  // and non-US listings 403. Yahoo's chart meta at least has the name; the
  // client fills the logo from a public CDN.
  if (!name) {
    const meta = await fetchYahooMeta(symbol);
    name = meta?.longName || meta?.shortName || "";
  }

  return NextResponse.json({ logo, name });
}
