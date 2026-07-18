import { NextResponse } from "next/server";
import { fetchYahooV7Quotes, toYahooSymbol } from "@/lib/yahoo";
import type { ExtQuote } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // lib/yahoo.ts uses node:https

// One batched Yahoo call covers every symbol; a short in-memory cache absorbs
// the engine's polling across clients (same pattern as /api/candles).
const CACHE_MS = 25_000;
let cache: { at: number; key: string; body: any } | null = null;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbols") || "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 120);
  if (symbols.length === 0) {
    return NextResponse.json({ error: "symbols required" }, { status: 400 });
  }

  const key = symbols.join(",");
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.body);
  }

  const toOriginal = new Map(symbols.map((s) => [toYahooSymbol(s), s]));
  const quotes = await fetchYahooV7Quotes(Array.from(toOriginal.keys()));
  if (!quotes) {
    if (cache && cache.key === key) return NextResponse.json(cache.body); // stale beats nothing
    return NextResponse.json({ error: "upstream unreachable" }, { status: 502 });
  }

  // Only symbols currently in an extended session carry the fields; everything
  // else (regular hours, closed, indices, FX) is simply absent from the map.
  const ext: Record<string, ExtQuote> = {};
  // Regular-session price (and name, when Yahoo has one) for every symbol —
  // the client uses this as a batched bootstrap so first paint doesn't wait
  // on the per-symbol Finnhub queue.
  const reg: Record<string, { c: number; pc: number; n?: string }> = {};
  for (const q of quotes) {
    const sym = toOriginal.get(q.symbol);
    if (!sym) continue;
    if (q.regularMarketPrice == null || q.regularMarketPreviousClose == null) continue;
    const n = q.longName || q.shortName;
    reg[sym] = { c: q.regularMarketPrice, pc: q.regularMarketPreviousClose, ...(n ? { n } : {}) };
    const regFields = { regPrice: q.regularMarketPrice, regPrevClose: q.regularMarketPreviousClose };
    if (q.marketState === "PRE" && q.preMarketPrice != null && q.preMarketChange != null) {
      ext[sym] = {
        state: "pre",
        price: q.preMarketPrice,
        chg: q.preMarketChange,
        pct: q.preMarketChangePercent ?? 0,
        ...regFields,
      };
    } else if (
      // PREPRE = overnight after post-market; TradingView keeps showing the
      // post-market numbers through the night, so we do too.
      (q.marketState === "POST" || q.marketState === "POSTPOST" || q.marketState === "PREPRE") &&
      q.postMarketPrice != null &&
      q.postMarketChange != null
    ) {
      ext[sym] = {
        state: "post",
        price: q.postMarketPrice,
        chg: q.postMarketChange,
        pct: q.postMarketChangePercent ?? 0,
        ...regFields,
      };
    }
  }

  const body = { ext, reg };
  cache = { at: Date.now(), key, body };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, s-maxage=25, stale-while-revalidate=120" },
  });
}
