import { NextResponse } from "next/server";
import { fetchYahooTimeseries, fetchYahooSummary } from "@/lib/yahoo";
import type { Financials, FinPeriod, EpsPoint } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // lib/yahoo.ts uses node:https

// Statements only change on a reporting cadence — cache hard.
const CACHE_MS = 6 * 60 * 60_000;
const cache = new Map<string, { at: number; body: Financials }>();

const METRICS = [
  "TotalRevenue",
  "NetIncome",
  "TotalAssets",
  "TotalLiabilitiesNetMinorityInterest",
  "OperatingCashFlow",
  "InvestingCashFlow",
  "FinancingCashFlow",
  "FreeCashFlow",
] as const;

type Series = Record<string, { date: string; value: number }[]>;

/** Quarterly labels read better as "Q1 '26" than a raw period-end date. */
function quarterLabel(date: string): string {
  const [y, m] = date.split("-");
  const q = Math.floor((Number(m) - 1) / 3) + 1;
  return `Q${q} '${y.slice(2)}`;
}

/**
 * Pivot per-metric series into per-period rows. Metrics can disagree on which
 * periods they cover (banks report no quarterly cash flow, for one), so the
 * period axis is the union of every metric's dates and gaps stay null.
 */
function toPeriods(series: Series, quarterly: boolean, limit: number): FinPeriod[] {
  const dates = new Set<string>();
  for (const key of METRICS) for (const p of series[key] ?? []) dates.add(p.date);
  const sorted = Array.from(dates).sort().slice(-limit);

  const at = (key: string, date: string): number | null => {
    const hit = (series[key] ?? []).find((p) => p.date === date);
    return hit ? hit.value : null;
  };

  return sorted.map((date) => ({
    label: quarterly ? quarterLabel(date) : date.slice(0, 4),
    revenue: at("TotalRevenue", date),
    netIncome: at("NetIncome", date),
    assets: at("TotalAssets", date),
    liabilities: at("TotalLiabilitiesNetMinorityInterest", date),
    operating: at("OperatingCashFlow", date),
    investing: at("InvestingCashFlow", date),
    financing: at("FinancingCashFlow", date),
    freeCashFlow: at("FreeCashFlow", date),
  }));
}

const METRIC_KEYS = [
  "revenue",
  "netIncome",
  "assets",
  "liabilities",
  "operating",
  "investing",
  "financing",
] as const;

const hasAny = (rows: FinPeriod[]) => rows.some((r) => METRIC_KEYS.some((k) => r[k] != null));

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body);

  const [annualRaw, quarterlyRaw, summary] = await Promise.all([
    fetchYahooTimeseries(symbol, METRICS.map((m) => "annual" + m)),
    fetchYahooTimeseries(symbol, METRICS.map((m) => "quarterly" + m)),
    fetchYahooSummary(symbol, ["earnings", "price"]),
  ]);

  if (!annualRaw && !quarterlyRaw && !summary) {
    if (hit) return NextResponse.json(hit.body);
    return NextResponse.json({ error: "upstream unreachable" }, { status: 502 });
  }

  const annual = toPeriods(annualRaw ?? {}, false, 5);
  const quarterly = toPeriods(quarterlyRaw ?? {}, true, 5);

  // Actual-vs-estimate EPS for the last few quarters.
  const eps: EpsPoint[] = (summary?.earnings?.earningsChart?.quarterly ?? [])
    .map((q: any) => ({
      label: q.date ?? "",
      actual: typeof q.actual?.raw === "number" ? q.actual.raw : null,
      estimate: typeof q.estimate?.raw === "number" ? q.estimate.raw : null,
    }))
    .filter((e: EpsPoint) => e.label && (e.actual != null || e.estimate != null));

  const body: Financials = {
    currency: summary?.earnings?.financialCurrency ?? summary?.price?.currency ?? null,
    annual: hasAny(annual) ? annual : [],
    quarterly: hasAny(quarterly) ? quarterly : [],
    eps,
  };

  cache.set(symbol, { at: Date.now(), body });
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" },
  });
}
