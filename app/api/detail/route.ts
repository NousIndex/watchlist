import { NextResponse } from "next/server";
import { fetchYahooSummary } from "@/lib/yahoo";
import type { Detail, Holding, TickerEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // lib/yahoo.ts uses node:https

// Profile text, analyst coverage and scheduled events all move on a scale of
// days, so this caches far harder than quotes do.
const CACHE_MS = 60 * 60_000;
const cache = new Map<string, { at: number; body: Detail }>();

const MODULES = [
  "assetProfile",
  "calendarEvents",
  "recommendationTrend",
  "financialData",
  "defaultKeyStatistics",
  "fundProfile",
  "topHoldings",
  "price",
];

const num = (v: any): number | null =>
  v && typeof v.raw === "number" && isFinite(v.raw) ? v.raw : null;

/**
 * Yahoo timestamps are epoch seconds at UTC midnight for calendar dates.
 * Formatting through the server's local zone would shift the day backwards
 * for anyone west of UTC, so pull the date parts straight out of UTC.
 */
function isoDate(ts: number | null): string | null {
  if (ts == null) return null;
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body);

  const res = await fetchYahooSummary(symbol, MODULES);
  if (!res) {
    if (hit) return NextResponse.json(hit.body); // stale beats nothing
    return NextResponse.json({ error: "upstream unreachable" }, { status: 502 });
  }

  const profile = res.assetProfile ?? res.summaryProfile ?? {};
  const cal = res.calendarEvents ?? {};
  const fin = res.financialData ?? {};
  const fund = res.fundProfile ?? {};
  const price = res.price ?? {};

  // Events, soonest first. Yahoo gives earnings as an array (a confirmed date,
  // or a low/high window when it's only estimated) — the first entry is the
  // one to show.
  const events: TickerEvent[] = [];
  const earningsTs = num(cal.earnings?.earningsDate?.[0]);
  const earningsDate = isoDate(earningsTs);
  if (earningsDate) {
    events.push({
      kind: "earnings",
      date: earningsDate,
      estimated: cal.earnings?.isEarningsDateEstimate === true,
    });
  }
  const exDiv = isoDate(num(cal.exDividendDate));
  if (exDiv) events.push({ kind: "exdiv", date: exDiv });
  const divDate = isoDate(num(cal.dividendDate));
  if (divDate) events.push({ kind: "dividend", date: divDate });
  // Yahoo keeps returning the last known date long after it passes. Rendered
  // under an "Events" heading a past date reads as upcoming, so drop anything
  // before today; the section hides itself when nothing is scheduled.
  const todayIso = new Date().toISOString().slice(0, 10);
  const upcoming = events
    .filter((e) => e.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date));

  const trend = res.recommendationTrend?.trend?.[0];
  const counts = trend
    ? {
        strongBuy: trend.strongBuy ?? 0,
        buy: trend.buy ?? 0,
        hold: trend.hold ?? 0,
        sell: trend.sell ?? 0,
        strongSell: trend.strongSell ?? 0,
      }
    : null;
  const total = counts
    ? counts.strongBuy + counts.buy + counts.hold + counts.sell + counts.strongSell
    : 0;

  const holdings: Holding[] = (res.topHoldings?.holdings ?? [])
    .slice(0, 10)
    .map((h: any) => ({
      symbol: h.symbol ?? "",
      name: h.holdingName ?? "",
      pct: (num(h.holdingPercent) ?? 0) * 100,
    }))
    .filter((h: Holding) => h.symbol || h.name);

  const body: Detail = {
    type: price.quoteType ?? null,
    name: price.longName ?? price.shortName ?? null,
    summary: profile.longBusinessSummary ?? null,
    sector: profile.sector ?? null,
    industry: profile.industry ?? null,
    country: profile.country ?? null,
    employees: typeof profile.fullTimeEmployees === "number" ? profile.fullTimeEmployees : null,
    website: profile.website ?? null,
    fundFamily: fund.family ?? null,
    category: fund.categoryName ?? null,
    holdings,
    events: upcoming,
    analysts:
      counts && total > 0
        ? {
            ...counts,
            total,
            consensus: fin.recommendationKey ?? null,
            targetMean: num(fin.targetMeanPrice),
            targetHigh: num(fin.targetHighPrice),
            targetLow: num(fin.targetLowPrice),
          }
        : null,
    revenueGrowth: num(fin.revenueGrowth),
    profitMargins: num(fin.profitMargins),
    epsForward: num(res.defaultKeyStatistics?.forwardEps),
  };

  cache.set(symbol, { at: Date.now(), body });
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
