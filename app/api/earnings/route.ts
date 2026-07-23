import { NextResponse } from "next/server";
import { fetchYahooSummary } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // lib/yahoo.ts uses node:https

/**
 * Batched upcoming-earnings dates for a set of watchlist symbols — the data
 * behind the Earnings calendar. One call fans out to Yahoo's quoteSummary per
 * equity (crypto/indices/FX/futures never have earnings and are skipped before
 * the request), caches each symbol for an hour, and returns only symbols with a
 * scheduled call today or later, soonest first.
 */

// Earnings dates move on a scale of days, so this caches as hard as /api/detail.
const CACHE_MS = 60 * 60_000;
const cache = new Map<string, { at: number; item: EarningsItem | null }>();

// How many Yahoo requests to have in flight at once. Yahoo's edge rate-limits
// bursts per IP, so we trickle rather than fire the whole list at once.
const CONCURRENCY = 6;

export interface EarningsItem {
  symbol: string;
  name: string | null;
  /** ISO yyyy-mm-dd. */
  date: string;
  /** Yahoo flags dates it inferred rather than confirmed. */
  estimated: boolean;
}

const num = (v: any): number | null =>
  v && typeof v.raw === "number" && isFinite(v.raw) ? v.raw : null;

/** Epoch seconds -> yyyy-mm-dd, read out of UTC so the day never shifts. */
function isoDate(ts: number | null): string | null {
  if (ts == null) return null;
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Symbols that can never have an earnings call — skip the network round-trip. */
function hasNoEarnings(symbol: string): boolean {
  return (
    symbol.startsWith("BINANCE:") || // crypto
    /^[A-Z0-9]+-USD$/.test(symbol) || // Yahoo-sourced crypto
    /[\^=]/.test(symbol) // indices / FX / futures
  );
}

async function fetchOne(symbol: string): Promise<EarningsItem | null> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.item;

  const res = await fetchYahooSummary(symbol, ["calendarEvents", "price"]);
  if (!res) return hit?.item ?? null; // stale beats a hole when upstream throttles

  const earnings = res.calendarEvents?.earnings ?? {};
  const date = isoDate(num(earnings.earningsDate?.[0]));
  const item: EarningsItem | null = date
    ? {
        symbol,
        name: res.price?.longName ?? res.price?.shortName ?? null,
        date,
        estimated: earnings.isEarningsDateEstimate === true,
      }
    : null;

  cache.set(symbol, { at: Date.now(), item });
  return item;
}

/** Run `fn` over `items` with a fixed number of workers. */
async function mapPool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbols") ?? "";
  const symbols = Array.from(
    new Set(raw.split(",").map((s) => s.trim()).filter(Boolean).filter((s) => !hasNoEarnings(s)))
  );
  if (symbols.length === 0) return NextResponse.json({ items: [] });

  const results = await mapPool(symbols, CONCURRENCY, fetchOne);
  const todayIso = new Date().toISOString().slice(0, 10);
  const items = results
    .filter((x): x is EarningsItem => x != null && x.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));

  return NextResponse.json({ items });
}
