import https from "node:https";

/**
 * Server-side helpers for Yahoo Finance's public chart API.
 * Used for candles (all exchanges, free) and as a quote/stats fallback for
 * non-US symbols that Finnhub's free tier can't serve.
 */

// Browser-like headers matter: undici's fetch defaults (accept-language: *)
// read as a bot to Yahoo's edge and get throttled far more aggressively.
export const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

// Chrome's cipher preference. Yahoo fingerprints TLS: Node's default cipher
// order gets 429'd on some clusters (notably LSE symbols) while the same
// request with a browser-like ClientHello passes. Verified A/B: default
// order 429, this order 200, same moment, same IP.
const BROWSER_CIPHERS = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-RSA-AES128-SHA",
  "ECDHE-RSA-AES256-SHA",
  "AES128-GCM-SHA256",
  "AES256-GCM-SHA384",
  "AES128-SHA",
  "AES256-SHA",
].join(":");

/**
 * GET a Yahoo endpoint with a fresh connection per request (agent: false).
 * Yahoo throttles per connection/TLS session: once a pooled keep-alive
 * connection starts 429ing, every request reusing it keeps 429ing. Fresh
 * connections avoid that; volume here is tiny (user-initiated + cached).
 */
// Yahoo's edge is far more lenient to requests carrying a valid session
// cookie — without one, datacenter IPs (Vercel) get 429'd aggressively.
// fc.yahoo.com hands out an A1 cookie to anyone (the response itself is a
// 404; only the set-cookie matters). Cached per process.
let a1Cookie: string | null = null;
let a1At = 0;
const A1_TTL_MS = 60 * 60_000;

function fetchA1Cookie(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      "https://fc.yahoo.com/",
      { headers: YAHOO_HEADERS, agent: false, timeout: 6_000, ciphers: BROWSER_CIPHERS },
      (res) => {
        const a1 = (res.headers["set-cookie"] || []).find((c) => c.startsWith("A1="));
        res.resume();
        if (a1) {
          a1Cookie = a1.split(";")[0];
          a1At = Date.now();
        }
        resolve(a1Cookie);
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve(a1Cookie));
  });
}

export async function yahooGetJson(url: string): Promise<{ status: number; json: any | null }> {
  const cookie = a1Cookie && Date.now() - a1At < A1_TTL_MS ? a1Cookie : null;
  const first = await yahooGetOnce(url, cookie);
  if (first.status === 200) return first;
  if (first.status !== 429 && first.status !== 0) return first;
  // Throttling is per connection attempt and flappy; one spaced retry on a
  // fresh connection often passes. Grab a session cookie if we didn't have
  // one, and retry against query2 — Yahoo's edges rate-limit independently,
  // so one host can pass while the other 429s.
  const retryCookie = cookie ?? (await fetchA1Cookie());
  await new Promise((r) => setTimeout(r, 900));
  const second = await yahooGetOnce(url.replace("//query1.", "//query2."), retryCookie);
  return second.status === 200 || first.status === 0 ? second : first;
}

function yahooGetOnce(
  url: string,
  cookie: string | null = null
): Promise<{ status: number; json: any | null }> {
  const headers = cookie ? { ...YAHOO_HEADERS, Cookie: cookie } : YAHOO_HEADERS;
  return new Promise((resolve) => {
    const req = https.get(
      url,
      { headers, agent: false, timeout: 6_000, ciphers: BROWSER_CIPHERS },
      (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let json: any | null = null;
        try {
          json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {}
        resolve({ status: res.statusCode || 0, json });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve({ status: 0, json: null }));
  });
}

/** Map a stored (Finnhub-style) symbol to Yahoo's convention. */
export function toYahooSymbol(symbol: string): string {
  // Hong Kong tickers are zero-padded to 4 digits on Yahoo (700.HK -> 0700.HK)
  const hk = symbol.match(/^(\d{1,4})\.HK$/);
  if (hk) return hk[1].padStart(4, "0") + ".HK";
  // Other suffixes (.L, .SI, .T, ...) match Yahoo's convention already.
  return symbol;
}

export interface YahooMeta {
  currency?: string;
  exchangeName?: string;
  fullExchangeName?: string;
  instrumentType?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  longName?: string;
  shortName?: string;
}

// Short shared cache so quote polling for non-US symbols doesn't hammer
// Yahoo (its edge rate-limits bursts per IP).
const META_CACHE_MS = 30_000;
const metaCache = new Map<string, { at: number; meta: YahooMeta }>();

/** Fetch chart meta (price, prev close, 52w range, volume, name) for a symbol. */
export async function fetchYahooMeta(symbol: string): Promise<YahooMeta | null> {
  const hit = metaCache.get(symbol);
  if (hit && Date.now() - hit.at < META_CACHE_MS) return hit.meta;
  const { status, json } = await yahooGetJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      toYahooSymbol(symbol)
    )}?range=1d&interval=1d&includePrePost=false`
  );
  const meta: YahooMeta | null = status === 200 ? json?.chart?.result?.[0]?.meta ?? null : null;
  if (meta) {
    metaCache.set(symbol, { at: Date.now(), meta });
    return meta;
  }
  return hit?.meta ?? null; // stale beats nothing when upstream throttles
}
