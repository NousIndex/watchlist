import { NextResponse } from "next/server";
import { toYahooSymbol, yahooGetJson } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // lib/yahoo.ts uses node:https
export const maxDuration = 30; // Yahoo (6s + one retry) + Twelve Data fallback

const RANGES: Record<
  string,
  { range: string; interval: string; tdInterval: string; tdSize: number; intraday: boolean }
> = {
  "1D": { range: "1d", interval: "5m", tdInterval: "5min", tdSize: 100, intraday: true },
  "1W": { range: "5d", interval: "15m", tdInterval: "30min", tdSize: 70, intraday: true },
  "1M": { range: "1mo", interval: "60m", tdInterval: "1h", tdSize: 160, intraday: true },
  "6M": { range: "6mo", interval: "1d", tdInterval: "1day", tdSize: 130, intraday: false },
  "1Y": { range: "1y", interval: "1d", tdInterval: "1day", tdSize: 260, intraday: false },
  "5Y": { range: "5y", interval: "1wk", tdInterval: "1week", tdSize: 265, intraday: false },
};

type Candle = { time: number | string; open: number; high: number; low: number; close: number };

// In-memory cache: fresh hits skip upstream; stale entries are served when
// upstream rate-limits (Yahoo 429s bursts for ~a minute).
const FRESH_MS = 60_000;
const cache = new Map<string, { at: number; body: any }>();

async function fromYahoo(symbolRaw: string, cfg: (typeof RANGES)[string]) {
  const params = new URLSearchParams({
    range: cfg.range,
    interval: cfg.interval,
    includePrePost: "false",
  });
  const { status, json: d } = await yahooGetJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      toYahooSymbol(symbolRaw)
    )}?${params}`
  );
  if (status !== 200) return { error: `upstream ${status || "unreachable"}` };
  const result = d?.chart?.result?.[0];
  const ts: number[] = result?.timestamp || [];
  const q = result?.indicators?.quote?.[0];
  if (!result || !q || ts.length === 0) {
    return { error: d?.chart?.error?.description || "no data" };
  }

  // Shift timestamps by the exchange's UTC offset so intraday charts read in
  // exchange-local time (lightweight-charts renders timestamps as UTC).
  const gmtoffset: number = result.meta?.gmtoffset || 0;
  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    const t = ts[i] + gmtoffset;
    candles.push({
      time: cfg.intraday ? t : new Date(t * 1000).toISOString().slice(0, 10),
      open: o,
      high: h,
      low: l,
      close: c,
    });
  }
  if (candles.length === 0) return { error: "no data" };
  return { candles };
}

async function fromTwelveData(symbolRaw: string, cfg: (typeof RANGES)[string]) {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) return { error: "no fallback key" };

  let symbol = symbolRaw;
  let exchange = "";
  const m = symbolRaw.match(/^(.+)\.([A-Z]+)$/);
  if (m) {
    symbol = m[1];
    exchange = { L: "LSE", SI: "SGX", HK: "HKEX", T: "TSE" }[m[2]] || "";
  }

  const params = new URLSearchParams({
    symbol,
    interval: cfg.tdInterval,
    outputsize: String(cfg.tdSize),
    timezone: "UTC",
    apikey: key,
  });
  if (exchange) params.set("exchange", exchange);

  const r = await fetch(`https://api.twelvedata.com/time_series?${params}`, {
    cache: "no-store",
  });
  const d = await r.json();
  if (d.status === "error" || !Array.isArray(d.values)) {
    return { error: d.message || "no data" };
  }
  const candles: Candle[] = d.values
    .map((v: any) => ({
      time: cfg.intraday
        ? Math.floor(Date.parse(v.datetime.replace(" ", "T") + "Z") / 1000)
        : v.datetime.slice(0, 10),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
    }))
    .reverse();
  return { candles };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbolRaw = url.searchParams.get("symbol") || "";
  const range = url.searchParams.get("range") || "6M";
  const cfg = RANGES[range] || RANGES["6M"];
  if (!symbolRaw) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const key = `${symbolRaw}|${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return NextResponse.json(hit.body);

  let out = await fromYahoo(symbolRaw, cfg);
  if (!("candles" in out)) {
    if (hit) return NextResponse.json(hit.body); // stale beats nothing
    const td = await fromTwelveData(symbolRaw, cfg);
    if ("candles" in td) out = td;
    // Name both failures — this string surfaces in the chart modal, and it's
    // the only visibility we have into what went wrong on the deployment.
    else out = { error: `yahoo: ${out.error} · twelvedata: ${td.error}` };
  }
  if (!("candles" in out)) {
    return NextResponse.json({ error: (out as any).error || "no data" }, { status: 502 });
  }

  const body = { candles: out.candles, intraday: cfg.intraday };
  cache.set(key, { at: Date.now(), body });
  // On Vercel the in-memory cache dies with the lambda; let the CDN cache
  // per-URL instead (middleware auth still runs before the cache).
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
