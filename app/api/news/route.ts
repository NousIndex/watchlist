import { NextResponse } from "next/server";
import { yahooGetJson } from "@/lib/yahoo";
import type { NewsItem } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // lib/yahoo.ts uses node:https

const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; body: { news: NewsItem[] } }>();

/**
 * Yahoo's search endpoint ranks loosely: querying a non-US ticker returns
 * general market noise (D05.SI came back with MongoDB and Amerisafe stories).
 * Querying the company NAME is far more accurate, so we ask for both and then
 * keep only stories that actually name the company or its ticker. An empty
 * list is the honest answer — better than presenting unrelated headlines as
 * the ticker's news.
 */

const SUFFIXES =
  /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|llc|lp|nv|sa|ag|se|group|holdings?|trust|etf|fund|class\s+[a-z]|the)\b/gi;

/** "DBS Group Holdings Ltd" -> "dbs" · "Rocket Lab Corporation" -> "rocket lab" */
function coreName(name: string): string {
  return name
    .replace(/[.,()]/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Ticker forms worth matching: "D05.SI" also appears as plain "D05". */
function tickerForms(symbol: string): string[] {
  const base = symbol.replace(/^[A-Z]+:/, "");
  const bare = base.split(".")[0];
  return Array.from(new Set([base, bare])).filter((t) => t.length >= 2);
}

function relevant(text: string, tickers: string[], core: string): boolean {
  const hay = text.toLowerCase();
  for (const t of tickers) {
    // Word-boundary match so "PL" doesn't hit inside "planet".
    if (new RegExp(`(^|[^a-z0-9])${t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(hay))
      return true;
  }
  if (!core) return false;
  if (hay.includes(core)) return true;
  // A distinctive first word ("Rocket", "IonQ") still counts; short or generic
  // fragments would match half the feed, so require some length.
  const first = core.split(" ")[0];
  return first.length >= 4 && hay.includes(first);
}

async function search(q: string): Promise<any[]> {
  const { status, json } = await yahooGetJson(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      q
    )}&quotesCount=0&newsCount=12&enableFuzzyQuery=false`
  );
  return status === 200 && Array.isArray(json?.news) ? json.news : [];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol");
  const name = url.searchParams.get("name") || "";
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const key = symbol + "|" + name;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body);

  const core = name ? coreName(name) : "";
  // Query with the FULL name, not the stripped one: Yahoo's search matches the
  // registered company name, so "DBS Group Holdings Ltd" returns real DBS
  // stories while the bare "dbs" returns its generic filler feed. The stripped
  // core is only for judging relevance afterwards.
  const queries = Array.from(new Set([name, symbol].filter(Boolean)));
  const batches = await Promise.all(queries.map(search));

  const seen = new Set<string>();
  const tickers = tickerForms(symbol);
  const news: NewsItem[] = [];
  for (const batch of batches) {
    for (const n of batch) {
      const id = n.uuid || n.link;
      if (!id || seen.has(id)) continue;
      const title = n.title || "";
      if (!title || !n.link) continue;
      if (!relevant(`${title} ${n.summary ?? ""}`, tickers, core)) continue;
      seen.add(id);
      news.push({
        id,
        title,
        publisher: n.publisher || "",
        link: n.link,
        published: typeof n.providerPublishTime === "number" ? n.providerPublishTime : 0,
        thumbnail: n.thumbnail?.resolutions?.length
          ? n.thumbnail.resolutions[n.thumbnail.resolutions.length - 1].url
          : null,
      });
    }
  }
  news.sort((a, b) => b.published - a.published);

  const body = { news: news.slice(0, 15) };
  cache.set(key, { at: Date.now(), body });
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800" },
  });
}
