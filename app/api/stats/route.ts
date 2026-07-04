import { NextResponse } from "next/server";
import { fetchYahooMeta } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // lib/yahoo.ts uses node:https

const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; body: any }>();

async function fetchFinnhub(path: string, key: string): Promise<any | null> {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/${path}&token=${key}`, {
      cache: "no-store",
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body);

  const key = process.env.FINNHUB_API_KEY || "";
  const enc = encodeURIComponent(symbol);
  const [meta, metricRes, profile] = await Promise.all([
    fetchYahooMeta(symbol),
    key ? fetchFinnhub(`stock/metric?symbol=${enc}&metric=all`, key) : null,
    key ? fetchFinnhub(`stock/profile2?symbol=${enc}`, key) : null,
  ]);
  const m = metricRes?.metric || {};

  // Finnhub reports market cap in $M and average volumes in millions of shares.
  const marketCap =
    profile?.marketCapitalization || m.marketCapitalization
      ? (profile?.marketCapitalization || m.marketCapitalization) * 1e6
      : null;
  const avgVol10D = m["10DayAverageTradingVolume"] ? m["10DayAverageTradingVolume"] * 1e6 : null;
  const avgVol3M = m["3MonthAverageTradingVolume"] ? m["3MonthAverageTradingVolume"] * 1e6 : null;

  const body = {
    name: meta?.longName || meta?.shortName || profile?.name || null,
    exchange: meta?.fullExchangeName || meta?.exchangeName || profile?.exchange || null,
    currency: meta?.currency || profile?.currency || null,
    type: meta?.instrumentType || null,
    dayHigh: meta?.regularMarketDayHigh ?? null,
    dayLow: meta?.regularMarketDayLow ?? null,
    volume: meta?.regularMarketVolume ?? null,
    avgVol10D,
    avgVol3M,
    high52: meta?.fiftyTwoWeekHigh ?? m["52WeekHigh"] ?? null,
    low52: meta?.fiftyTwoWeekLow ?? m["52WeekLow"] ?? null,
    marketCap,
    beta: m.beta ?? null,
    peTTM: m.peTTM ?? m.peBasicExclExtraTTM ?? null,
    epsTTM: m.epsTTM ?? m.epsBasicExclExtraItemsTTM ?? null,
    dividendYield: m.dividendYieldIndicatedAnnual ?? m.currentDividendYieldTTM ?? null,
  };
  // Cache only successful lookups; a transient upstream failure shouldn't
  // pin an all-null response for the next 5 minutes.
  if (Object.values(body).some((v) => v !== null)) {
    cache.set(symbol, { at: Date.now(), body });
    // CDN cache for Vercel, where the in-memory cache dies with the lambda.
    return NextResponse.json(body, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  }
  return NextResponse.json(body);
}
