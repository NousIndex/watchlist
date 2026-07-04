# StockWatch

Personal TradingView-style watchlist. Next.js on Vercel, live prices via Finnhub websocket, charts via Yahoo Finance, USD/SGD toggle, draggable tabs and sections, password-gated.

## Setup

1. Get free API keys:
   - Finnhub: https://finnhub.io/register (quotes, search, logos, live websocket, key stats)
   - Twelve Data (optional): https://twelvedata.com/register (chart fallback if Yahoo rate-limits)
2. Push this folder to a GitHub repo.
3. Import the repo in Vercel (framework auto-detected as Next.js).
4. Add environment variables in Vercel → Project → Settings → Environment Variables:
   - `FINNHUB_API_KEY`
   - `TWELVEDATA_API_KEY` (optional fallback)
   - `APP_PASSWORD` — your login password (omit to run with no auth)
5. Deploy. Open the URL on your phone → Share → **Add to Home Screen** for a fullscreen app.

Local dev: `cp .env.example .env.local`, fill keys, `npm install && npm run dev`.

## How it works

- **Live prices**: the browser opens a Finnhub websocket and subscribes only to rows currently on screen (IntersectionObserver), staying far under the free tier's 50-subscription cap. Visible US tickers tick in real time.
- **REST fallback**: one shared queue makes ~46 Finnhub calls/min (under the 60/min cap), prioritised: visible & unloaded → visible & stale (15s) → unloaded → off-screen stale (90s) → missing logos. Non-US tickers and indices that aren't on the free websocket still refresh this way.
- **State**: watchlist structure (tabs → sections → symbols) and last-known quotes live in localStorage. No database. Quotes paint instantly from cache on open, then refresh.
- **Currency**: USD→SGD rate from frankfurter.dev (ECB), cached 1h. Toggle converts list prices; chart candles stay in the instrument's native currency.
- **Auth**: middleware checks an httpOnly cookie against `APP_PASSWORD`. All API routes (including the websocket token) are behind it.
- **Crypto**: sourced from Binance's public API directly in the browser — no key, no proxy, zero impact on the other quotas. One batched REST call every 10s covers *all* crypto symbols; visible pairs additionally stream live (~1s) over Binance's miniTicker websocket. Change % uses the rolling 24h basis (crypto has no "previous close"). Charts come from Binance klines. Add pairs via the **Crypto** chip in the search sheet (any Binance pair, e.g. `TAOUSDT`, `AKTUSDT`, `PENDLEUSDT`).

## Usage

- **Edit** → drag rows (long-press) to reorder or move between sections, ⊖ to remove, ↑↓ to reorder sections, rename/delete tab, add section.
- Tabs: long-press and drag to reorder anytime; + to add. The **All** tab (always last) shows every symbol from every tab, grouped by tab.
- Tap a row for the ticker page: candlestick chart (1D–5Y) plus TradingView-style key stats.
- **Lists** (top-right of the ticker page) → tick the tabs the symbol should appear in; that's how you add or move an existing ticker between tabs.
- **+** searches Finnhub's whole symbol universe; pick a target section chip before adding. From the All tab it also asks which tab to add to.

## Limits & notes

- Finnhub free websocket streams **US stocks/ETFs only**; LSE tickers (e.g. `VWRA.L`) and indices update via REST polling instead (quotes fall back to Yahoo when Finnhub has no data).
- Charts come from Yahoo Finance's public chart API (all exchanges, no key). Responses are cached 60s server-side; if Yahoo rate-limits, the server serves the last cached data or falls back to Twelve Data (US symbols) when a key is set.
- Key stats: Yahoo chart meta (volume, 52-week range, day range) merged with Finnhub basic financials (market cap, beta, P/E, EPS, dividend yield — US symbols only on the free tier).
- Quotes are Finnhub real-time US consolidated; may differ a few cents from TradingView's feed.
- localStorage is per-device. Export/import or a sync layer (e.g. Vercel KV) would be the next step if you want the same lists on phone + desktop.
