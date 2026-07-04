import { NextResponse } from "next/server";
import { fetchYahooMeta } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // lib/yahoo.ts uses node:https

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return NextResponse.json({ error: "FINNHUB_API_KEY not set" }, { status: 500 });

  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`,
      { cache: "no-store" }
    );
    if (r.ok) {
      const d = await r.json();
      // c = current, pc = previous close; c === 0 means "no data" on Finnhub
      if (typeof d.c === "number" && d.c > 0) {
        return NextResponse.json({ c: d.c, pc: d.pc, t: d.t });
      }
    }
  } catch {}

  // Finnhub free tier can't quote non-US symbols (e.g. LSE) — fall back to Yahoo.
  const meta = await fetchYahooMeta(symbol);
  const c = meta?.regularMarketPrice;
  if (typeof c === "number" && c > 0) {
    const pc = meta?.chartPreviousClose ?? meta?.previousClose ?? c;
    // Brief CDN cache: absorbs the engine's polling so each Vercel lambda
    // doesn't hit Yahoo separately for the same symbol.
    return NextResponse.json(
      { c, pc, t: Date.now() },
      { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } }
    );
  }
  // 200 with null price: the client marks the symbol "no data" instead of retrying.
  return NextResponse.json({ c: null, pc: null, t: Date.now() });
}
