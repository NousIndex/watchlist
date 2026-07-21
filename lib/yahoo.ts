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
): Promise<{ status: number; json: any | null; text: string }> {
  const headers = cookie ? { ...YAHOO_HEADERS, Cookie: cookie } : YAHOO_HEADERS;
  return new Promise((resolve) => {
    const req = https.get(
      url,
      { headers, agent: false, timeout: 6_000, ciphers: BROWSER_CIPHERS },
      (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: any | null = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode || 0, json, text });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve({ status: 0, json: null, text: "" }));
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

/* ---------------- Crumb-authenticated v7 quote API ---------------- */

// v7/finance/quote is the only free endpoint with pre/post-market fields
// (v8 chart meta has none — verified). It needs a session cookie plus a
// crumb fetched WITH that same cookie; a crumb from a different session 401s.
let crumbPair: { cookie: string; crumb: string; at: number } | null = null;
const CRUMB_TTL_MS = 60 * 60_000;

function fetchHomepageCookies(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      "https://finance.yahoo.com/",
      {
        headers: { ...YAHOO_HEADERS, Accept: "text/html,application/xhtml+xml,*/*" },
        agent: false,
        timeout: 8_000,
        ciphers: BROWSER_CIPHERS,
        // Yahoo's homepage response headers blow past Node's 16 KB default.
        maxHeaderSize: 256 * 1024,
      },
      (res) => {
        res.resume();
        const cookies = (res.headers["set-cookie"] || [])
          .map((c) => c.split(";")[0])
          .filter((c) => /^(A1|A3|A1S)=/.test(c));
        resolve(cookies.length ? cookies.join("; ") : null);
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve(null));
  });
}

async function getCrumbPair(force = false): Promise<{ cookie: string; crumb: string } | null> {
  if (!force && crumbPair && Date.now() - crumbPair.at < CRUMB_TTL_MS) return crumbPair;
  // fc.yahoo.com's A1 as fallback — the homepage is occasionally consent-walled.
  const cookie = (await fetchHomepageCookies()) ?? (await fetchA1Cookie());
  if (!cookie) return null;
  const { status, text } = await yahooGetOnce(
    "https://query1.finance.yahoo.com/v1/test/getcrumb",
    cookie
  );
  // The crumb is plain text; JSON bodies here are error envelopes.
  if (status !== 200 || !text || text.includes("{")) return null;
  crumbPair = { cookie, crumb: text.trim(), at: Date.now() };
  return crumbPair;
}

export interface YahooV7Quote {
  symbol: string;
  marketState?: string; // PREPRE | PRE | REGULAR | POST | POSTPOST | CLOSED
  preMarketPrice?: number;
  preMarketChange?: number; // vs previous regular close
  preMarketChangePercent?: number;
  postMarketPrice?: number;
  postMarketChange?: number; // vs regular close
  postMarketChangePercent?: number;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  longName?: string;
  shortName?: string;
  /** Listing currency — "SGD", "KRW", "GBp" (pence), … */
  currency?: string;
  /** EQUITY | ETF | INDEX | CURRENCY | FUTURE | CRYPTOCURRENCY */
  quoteType?: string;
}

/**
 * quoteSummary: company profile, calendar events, analyst coverage, fund
 * holdings. Same crumb auth as v7. Yahoo returns only the modules that apply
 * to the instrument — an ETF has no `calendarEvents`, an index has almost
 * nothing — so every caller must treat each module as optional.
 */
export async function fetchYahooSummary(
  symbol: string,
  modules: string[]
): Promise<any | null> {
  let pair = await getCrumbPair();
  if (!pair) return null;
  const url = (host: string) =>
    `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
      toYahooSymbol(symbol)
    )}?modules=${encodeURIComponent(modules.join(","))}&crumb=${encodeURIComponent(pair!.crumb)}`;
  let r = await yahooGetOnce(url("query1"), pair.cookie);
  if (r.status === 401 || r.status === 403) {
    pair = await getCrumbPair(true);
    if (!pair) return null;
    r = await yahooGetOnce(url("query1"), pair.cookie);
  } else if (r.status === 429 || r.status === 0) {
    await new Promise((res) => setTimeout(res, 900));
    r = await yahooGetOnce(url("query2"), pair.cookie);
  }
  if (r.status !== 200) return null;
  return r.json?.quoteSummary?.result?.[0] ?? null;
}

/**
 * Fundamentals timeseries — the current source for financial statements.
 * The legacy quoteSummary statement modules (balanceSheetHistory,
 * cashflowStatementHistory) still return 200 but their line items are gone:
 * the objects come back holding only `endDate`/`maxAge`. Verified against
 * GOOG. This endpoint has the real numbers.
 *
 * Returns { [typeWithoutPrefix]: [{ date, value }] }, oldest first.
 */
export async function fetchYahooTimeseries(
  symbol: string,
  types: string[]
): Promise<Record<string, { date: string; value: number }[]> | null> {
  let pair = await getCrumbPair();
  if (!pair) return null;
  const now = Math.floor(Date.now() / 1000);
  const start = now - 6 * 365 * 24 * 3600;
  const sym = toYahooSymbol(symbol);
  const url = (host: string) =>
    `https://${host}.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(
      sym
    )}?symbol=${encodeURIComponent(sym)}&type=${encodeURIComponent(
      types.join(",")
    )}&period1=${start}&period2=${now}&crumb=${encodeURIComponent(pair!.crumb)}`;

  let r = await yahooGetOnce(url("query1"), pair.cookie);
  if (r.status === 401 || r.status === 403) {
    pair = await getCrumbPair(true);
    if (!pair) return null;
    r = await yahooGetOnce(url("query1"), pair.cookie);
  } else if (r.status === 429 || r.status === 0) {
    await new Promise((res) => setTimeout(res, 900));
    r = await yahooGetOnce(url("query2"), pair.cookie);
  }
  if (r.status !== 200) return null;

  const out: Record<string, { date: string; value: number }[]> = {};
  for (const row of r.json?.timeseries?.result ?? []) {
    // Each row carries one type key alongside `meta`/`timestamp`.
    const key = Object.keys(row).find((k) => k !== "meta" && k !== "timestamp");
    if (!key) continue;
    const points = (row[key] ?? [])
      .filter((p: any) => p && p.asOfDate && typeof p.reportedValue?.raw === "number")
      .map((p: any) => ({ date: p.asOfDate as string, value: p.reportedValue.raw as number }));
    if (points.length) out[key.replace(/^(annual|quarterly)/, "")] = points;
  }
  return out;
}

/** Batched v7 quotes (Yahoo-convention symbols). Null on upstream failure. */
export async function fetchYahooV7Quotes(symbols: string[]): Promise<YahooV7Quote[] | null> {
  if (symbols.length === 0) return [];
  let pair = await getCrumbPair();
  if (!pair) return null;
  const url = (host: string) =>
    `https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
      symbols.join(",")
    )}&crumb=${encodeURIComponent(pair!.crumb)}`;
  let r = await yahooGetOnce(url("query1"), pair.cookie);
  if (r.status === 401 || r.status === 403) {
    // Expired/mismatched session — rebuild the cookie+crumb pair once.
    pair = await getCrumbPair(true);
    if (!pair) return null;
    r = await yahooGetOnce(url("query1"), pair.cookie);
  } else if (r.status === 429 || r.status === 0) {
    await new Promise((res) => setTimeout(res, 900));
    r = await yahooGetOnce(url("query2"), pair.cookie);
  }
  if (r.status !== 200) return null;
  return r.json?.quoteResponse?.result ?? null;
}
