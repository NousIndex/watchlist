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

export const displaySymbol = (symbol: string) =>
  isCrypto(symbol)
    ? cryptoPair(symbol)
    : isYahooCrypto(symbol)
    ? symbol.slice(0, -4)
    : SPECIAL_NAMES[symbol] ?? symbol;

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
  return scored.map((p) => ({
    symbol: CRYPTO_PREFIX + p,
    pair: p,
    description: "Binance · Crypto",
  }));
}
