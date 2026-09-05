"use client";

/**
 * Crypto symbols are stored with a "BINANCE:" prefix, e.g. "BINANCE:BTCUSDT".
 * All crypto data comes straight from Binance's public API in the browser —
 * no key, no proxy, and zero impact on the Finnhub/Twelve Data quotas.
 */

export const CRYPTO_PREFIX = "BINANCE:";

export const isCrypto = (symbol: string) => symbol.startsWith(CRYPTO_PREFIX);

/** "BINANCE:BTCUSDT" -> "BTCUSDT" */
export const cryptoPair = (symbol: string) => symbol.slice(CRYPTO_PREFIX.length);

/** "BINANCE:BTCUSDT" -> "BTC" (base asset, for the avatar) */
export function cryptoBase(symbol: string): string {
  const pair = cryptoPair(symbol);
  for (const q of ["USDT", "USDC", "FDUSD", "BUSD", "BTC", "ETH", "BNB", "SGD", "EUR", "TRY"]) {
    if (pair.endsWith(q) && pair.length > q.length) return pair.slice(0, -q.length);
  }
  return pair;
}

/** Friendly names for Yahoo-style index / FX / commodity symbols. */
const SPECIAL_NAMES: Record<string, string> = {
  "^GSPC": "SPX",
  "^NDX": "NDX",
  "^TNX": "US10Y",
  "GC=F": "GOLD",
  "CL=F": "USOIL",
  "SGD=X": "USDSGD",
};

/** Yahoo-sourced crypto pairs (coins not listed on Binance), e.g. "AKT-USD". */
export const isYahooCrypto = (symbol: string) => /^[A-Z0-9]+-USD$/.test(symbol);

/**
 * Non-US listings, indices, futures, FX, and Yahoo-sourced crypto — nothing
 * Finnhub's free tier can quote. These live entirely on the batched Yahoo
 * poll; the per-symbol Finnhub queue skips them instead of burning a
 * rate-limited slot on a guaranteed miss.
 */
const NON_US_SUFFIX =
  /\.(L|SI|HK|T|KS|KQ|TW|TWO|AX|NZ|PA|AS|BR|MC|MI|DE|F|BE|SW|VI|ST|OL|CO|HE|IR|LS|TO|V|NS|BO|SS|SZ|SA|MX|JO)$/;
export const isYahooOnly = (symbol: string) =>
  /[\^=]/.test(symbol) || isYahooCrypto(symbol) || NON_US_SUFFIX.test(symbol);

export const displaySymbol = (symbol: string) =>
  isCrypto(symbol)
    ? cryptoPair(symbol)
    : isYahooCrypto(symbol)
    ? symbol.slice(0, -4)
    : SPECIAL_NAMES[symbol] ?? symbol;

/* ---------------- Halted / delisted pair detection ---------------- */

/**
 * Binance never stops answering for a pair it has stopped trading — it just
 * replays the final tick forever. HNTUSDT still reports $4.67: its last trade,
 * 14 Oct 2022, when Helium migrated to Solana and the pair was halted. Nothing
 * in the payload says "halted", but two things give it away:
 *   - the order book is empty (no bid AND no ask), and
 *   - the rolling 24h window's closeTime stops tracking the present.
 * Either one is enough; together they cover both a pair seen alone (search)
 * and one seen in a batch (the poll).
 */
export const DEAD_PAIR_MS = 6 * 60 * 60_000;

/** The fields of Binance's /ticker/24hr payload this app reads. */
export interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  bidPrice?: string;
  askPrice?: string;
  closeTime?: number;
}

/**
 * Reference "now" for a batch. Clamped to the freshest closeTime in the same
 * response so a device clock running fast can't age the whole watchlist past
 * the threshold at once; a clock running slow only ever under-reports.
 */
export function tickerNow(batch: BinanceTicker[]): number {
  let newest = 0;
  for (const t of batch)
    if (typeof t.closeTime === "number" && t.closeTime > newest) newest = t.closeTime;
  return newest > 0 ? Math.min(Date.now(), newest) : Date.now();
}

export function isDeadTicker(t: BinanceTicker, now: number): boolean {
  // An empty book is what a halted pair gives away on its own, with no
  // healthy sibling in the response to date it against.
  const bid = parseFloat(t.bidPrice ?? "");
  const ask = parseFloat(t.askPrice ?? "");
  if (bid === 0 && ask === 0) return true;
  return typeof t.closeTime === "number" && now - t.closeTime > DEAD_PAIR_MS;
}

/** Of these pairs, the ones Binance has stopped trading. One batched call. */
export async function deadPairs(pairs: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (pairs.length === 0) return out;
  try {
    const r = await fetch(
      `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(
        JSON.stringify(pairs)
      )}`
    );
    if (!r.ok) return out;
    const d: BinanceTicker[] = await r.json();
    const now = tickerNow(d);
    for (const t of d) if (isDeadTicker(t, now)) out.add(t.symbol);
  } catch {}
  return out;
}

/**
 * "BINANCE:HNTUSDT" -> "HNT-USD": the Yahoo-sourced pair a row falls back to
 * when Binance stops trading the coin. Yahoo aggregates across exchanges, so
 * it keeps tracking a coin long after any single venue drops it.
 */
export const yahooAlias = (symbol: string) => cryptoBase(symbol) + "-USD";

/* ---------------- Binance pair search ---------------- */

let pairCache: string[] | null = null;
let pairPromise: Promise<string[]> | null = null;

async function loadPairs(): Promise<string[]> {
  if (pairCache) return pairCache;
  if (!pairPromise) {
    pairPromise = fetch("https://api.binance.com/api/v3/ticker/price")
      .then((r) => r.json())
      .then((d: { symbol: string }[]) => {
        pairCache = d.map((x) => x.symbol);
        return pairCache;
      })
      .catch(() => {
        pairPromise = null;
        return [];
      });
  }
  return pairPromise;
}

export interface CryptoResult {
  symbol: string; // with prefix
  pair: string;
  description: string;
  /** Still listed, but Binance has stopped trading it — the price is history. */
  dead?: boolean;
}

export async function searchCrypto(q: string): Promise<CryptoResult[]> {
  const pairs = await loadPairs();
  const Q = q.trim().toUpperCase();
  if (!Q) return [];
  const scored = pairs
    .filter((p) => p.includes(Q))
    .sort((a, b) => {
      // exact > starts-with > USDT pairs > shorter
      const score = (p: string) =>
        (p === Q ? 0 : p.startsWith(Q) ? 1 : 2) * 10 + (p.endsWith("USDT") ? 0 : 5) + p.length / 100;
      return score(a) - score(b);
    })
    .slice(0, 20);
  // The pair list carries halted pairs too (that is how a dead ticker gets
  // added in the first place). Flag them and sink them below the live ones.
  const dead = await deadPairs(scored);
  return scored
    .map((p) => ({
      symbol: CRYPTO_PREFIX + p,
      pair: p,
      description: dead.has(p) ? "Binance · not trading" : "Binance · Crypto",
      dead: dead.has(p),
    }))
    .sort((a, b) => Number(a.dead) - Number(b.dead));
}
