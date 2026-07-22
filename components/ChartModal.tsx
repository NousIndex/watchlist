"use client";
import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, type IChartApi } from "lightweight-charts";
import { useQuotes, useWatchlist, tabsWithSymbol } from "@/lib/store";
import { fmtPrice, fmtChange, fmtPct, fmtBig } from "@/lib/format";
import { isCrypto, cryptoPair, cryptoBase, displaySymbol } from "@/lib/crypto";
import { convertTo } from "@/lib/fx";
import { Avatar } from "./Avatar";
import { TickerOverview } from "./TickerOverview";
import { FinancialsTab } from "./Financials";
import { NewsTab } from "./News";

const TABS = ["Overview", "Financials", "News"] as const;
type TabKey = (typeof TABS)[number];

const RANGES = ["1D", "1W", "1M", "6M", "1Y", "5Y"] as const;
type Range = (typeof RANGES)[number];

// Remember the last range the user picked so it carries across tickers — the
// modal remounts per symbol, so component state alone would reset to 1D.
const RANGE_KEY = "chart-range";
function loadRange(): Range {
  if (typeof window === "undefined") return "1D";
  const v = window.localStorage.getItem(RANGE_KEY);
  return (RANGES as readonly string[]).includes(v ?? "") ? (v as Range) : "1D";
}

// Label for the point under the finger/cursor while scrubbing the chart.
// Intraday candles carry a unix-seconds `time` (already shifted to exchange-
// local and rendered as UTC by lightweight-charts); daily/weekly carry a
// "YYYY-MM-DD" string, which the library hands back as a BusinessDay object.
function fmtScrubTime(time: unknown, intraday: boolean): string {
  let d: Date;
  if (typeof time === "number") d = new Date(time * 1000);
  else if (typeof time === "string") d = new Date(time + "T00:00:00Z");
  else if (time && typeof time === "object") {
    const b = time as { year: number; month: number; day: number };
    d = new Date(Date.UTC(b.year, b.month - 1, b.day));
  } else return "";
  return intraday
    ? d.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
      })
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

// TradingView-style period P&L label ("+4.38 +10.60% past month"). 1D is
// excluded — the header already shows the daily change.
const PERIOD_LABEL: Record<string, string> = {
  "1W": "past week",
  "1M": "past month",
  "6M": "past 6 months",
  "1Y": "past year",
  "5Y": "past 5 years",
};

const BN_RANGES: Record<string, { interval: string; limit: number; intraday: boolean }> = {
  "1D": { interval: "5m", limit: 288, intraday: true },
  "1W": { interval: "30m", limit: 336, intraday: true },
  "1M": { interval: "2h", limit: 360, intraday: true },
  "6M": { interval: "1d", limit: 183, intraday: false },
  "1Y": { interval: "1d", limit: 365, intraday: false },
  "5Y": { interval: "1w", limit: 265, intraday: false },
};

async function fetchCandles(symbol: string, range: string) {
  if (isCrypto(symbol)) {
    const cfg = BN_RANGES[range];
    const r = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${cryptoPair(symbol)}&interval=${cfg.interval}&limit=${cfg.limit}`
    );
    if (!r.ok) return { error: `Binance ${r.status}` };
    const d: any[] = await r.json();
    const candles = d.map((k) => {
      const t = Math.floor(k[0] / 1000);
      return {
        time: cfg.intraday ? t : new Date(k[0]).toISOString().slice(0, 10),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
      };
    });
    return { candles };
  }
  const r = await fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&range=${range}`);
  const d = await r.json();
  if (!r.ok) return { error: d.error || "no data" };
  return d;
}

interface Stats {
  name?: string | null;
  exchange?: string | null;
  currency?: string | null;
  dayHigh?: number | null;
  dayLow?: number | null;
  volume?: number | null;
  avgVol10D?: number | null;
  avgVol3M?: number | null;
  high52?: number | null;
  low52?: number | null;
  marketCap?: number | null;
  beta?: number | null;
  peTTM?: number | null;
  epsTTM?: number | null;
  dividendYield?: number | null;
}

async function fetchStats(symbol: string): Promise<Stats | null> {
  if (isCrypto(symbol)) {
    const r = await fetch(
      `https://api.binance.com/api/v3/ticker/24hr?symbol=${cryptoPair(symbol)}`
    );
    if (!r.ok) return null;
    const d = await r.json();
    return {
      name: `${cryptoBase(symbol)} · Binance`,
      exchange: "Binance",
      dayHigh: parseFloat(d.highPrice),
      dayLow: parseFloat(d.lowPrice),
      volume: parseFloat(d.volume),
      avgVol3M: null,
      high52: null,
      low52: null,
      marketCap: parseFloat(d.quoteVolume), // repurposed below as 24h quote volume
    };
  }
  const r = await fetch(`/api/stats?symbol=${encodeURIComponent(symbol)}`);
  if (!r.ok) return null;
  return r.json();
}

function StatRow({ label, value }: { label: string; value: string }) {
  if (value === "—") return null;
  return (
    <div className="stat-row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ListsSheet({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const { tabs, toggleSymbolInTab } = useWatchlist();
  const inTabs = tabsWithSymbol(tabs, symbol);
  return (
    <>
      <div className="overlay" style={{ zIndex: 70 }} onClick={onClose} />
      <div className="sheet" style={{ zIndex: 71 }}>
        <div className="sheet-hdr">
          <span>{displaySymbol(symbol)} · Lists</span>
          <button onClick={onClose}>Done</button>
        </div>
        <div className="sheet-body">
          <div className="empty-hint" style={{ padding: "0 2px 10px", textAlign: "left" }}>
            Tick the tabs this symbol should appear in.
          </div>
          {tabs.map((t) => {
            const on = inTabs.has(t.id);
            return (
              <button
                key={t.id}
                className={`list-row${on ? " on" : ""}`}
                onClick={() => toggleSymbolInTab(t.id, symbol)}
              >
                <span>{t.name}</span>
                <span className="check">{on ? "✓" : ""}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function ChartModal({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [range, setRange] = useState<Range>(loadRange);
  const pickRange = (r: Range) => {
    setRange(r);
    try {
      window.localStorage.setItem(RANGE_KEY, r);
    } catch {
      /* storage blocked (private mode) — fall back to per-session state */
    }
  };
  const [msg, setMsg] = useState("Loading…");
  const [stats, setStats] = useState<Stats | null>(null);
  // First/last candle of the loaded range, for the period P&L line.
  const [period, setPeriod] = useState<{ base: number; last: number } | null>(null);
  const [showLists, setShowLists] = useState(false);
  const [tab, setTab] = useState<TabKey>("Overview");
  // Candle under the finger/cursor while scrubbing (Revolut-style); null when
  // not interacting, so the header falls back to the live price. `price` is in
  // native listing currency, same basis as `live`.
  const [scrub, setScrub] = useState<{
    o: number;
    h: number;
    l: number;
    c: number;
    time: unknown;
  } | null>(null);
  // Two-finger measure: the two pinned points (price + time) and their pixel x
  // for the on-chart marker lines. Null unless two fingers are on the plot.
  const [measure, setMeasure] = useState<{
    a: { x: number; open: number; close: number; time: unknown };
    b: { x: number; open: number; close: number; time: unknown };
  } | null>(null);
  const candlesRef = useRef<
    { time: unknown; open: number; high: number; low: number; close: number }[]
  >([]);
  const intraday = range === "1D" || range === "1W" || range === "1M";
  const boxRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const quote = useQuotes((s) => s.quotes[symbol]);
  const ext = useQuotes((s) => s.ext[symbol]);
  const profile = useQuotes((s) => s.profiles[symbol]);
  const currency = useWatchlist((s) => s.currency);
  const fxRates = useQuotes((s) => s.fxRates);
  const meta = useQuotes((s) => s.meta[symbol]);
  // Native listing currency -> display currency. `shownCcy` is null for index
  // levels and FX rates, which aren't money and get no currency label.
  const { factor: rate, ccy: shownCcy } = convertTo(meta?.cc, currency, fxRates, meta?.qt);

  useEffect(() => {
    let cancelled = false;
    fetchStats(symbol).then((s) => !cancelled && setStats(s));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const chart = createChart(box, {
      layout: {
        background: { type: ColorType.Solid, color: "#000000" },
        textColor: "#8a8f98",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      },
      grid: {
        vertLines: { color: "#16181d" },
        horzLines: { color: "#16181d" },
      },
      rightPriceScale: { borderColor: "#1c1d21" },
      timeScale: { borderColor: "#1c1d21", timeVisible: range === "1D" || range === "1W" || range === "1M" },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const series = chart.addCandlestickSeries({
      upColor: "#22ab94",
      downColor: "#f7525f",
      wickUpColor: "#22ab94",
      wickDownColor: "#f7525f",
      borderVisible: false,
    });

    // Scrub: mirror the hovered/touched candle into the header, clearing when
    // the pointer leaves the plot so it snaps back to the live price. Suppressed
    // while measuring so the two-finger gesture doesn't fight over the header.
    let measuring = false;
    chart.subscribeCrosshairMove((param) => {
      if (measuring) return;
      const bar = param.time && param.point ? (param.seriesData.get(series) as any) : null;
      if (!bar || bar.close == null || !isFinite(bar.close)) {
        setScrub(null);
        return;
      }
      setScrub({ o: bar.open, h: bar.high, l: bar.low, c: bar.close, time: param.time });
    });

    let cancelled = false;
    setMsg("Loading…");
    setPeriod(null);
    setScrub(null);
    setMeasure(null);
    candlesRef.current = [];
    fetchCandles(symbol, range)
      .then((d: any) => {
        if (cancelled) return;
        if (!d.candles?.length) {
          setMsg(d.error ? `No chart data (${d.error})` : "No chart data");
          return;
        }
        series.setData(d.candles);
        candlesRef.current = d.candles;
        chart.timeScale().fitContent();
        setPeriod({
          base: d.candles[0].open,
          last: d.candles[d.candles.length - 1].close,
        });
        setMsg("");
      })
      .catch(() => !cancelled && setMsg("Failed to load chart"));

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: box.clientWidth, height: box.clientHeight });
    });
    ro.observe(box);

    // Map a touch's screen x to the candle beneath it, snapping the marker line
    // to that candle's own x for a clean vertical.
    const pointAt = (clientX: number) => {
      const rect = box.getBoundingClientRect();
      const ts = chart.timeScale();
      const logical = ts.coordinateToLogical(clientX - rect.left);
      const candles = candlesRef.current;
      if (logical == null || !candles.length) return null;
      const i = Math.max(0, Math.min(candles.length - 1, Math.round(logical)));
      const c = candles[i];
      if (!c) return null;
      const cx = ts.logicalToCoordinate(i as any);
      return { x: cx == null ? clientX - rect.left : cx, open: c.open, close: c.close, time: c.time };
    };

    // Two-finger measure: take over the gesture (chart pan/zoom off) and report
    // the delta between the two candles under the fingers.
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        measuring = true;
        chart.applyOptions({ handleScroll: false, handleScale: false });
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length < 2) return;
      e.preventDefault();
      const p1 = pointAt(e.touches[0].clientX);
      const p2 = pointAt(e.touches[1].clientX);
      if (!p1 || !p2) return;
      setScrub(null);
      setMeasure(p1.x <= p2.x ? { a: p1, b: p2 } : { a: p2, b: p1 });
    };
    const endMeasure = (e: TouchEvent) => {
      if (e.touches.length >= 2 || !measuring) return;
      measuring = false;
      setMeasure(null);
      chart.applyOptions({ handleScroll: true, handleScale: true });
    };

    // Releasing/leaving the plot ends the scrub — otherwise touch devices keep
    // the crosshair pinned and the header stuck on an old candle.
    const endScrub = () => {
      if (measuring) return;
      chart.clearCrosshairPosition();
      setScrub(null);
    };
    const onTouchEnd = (e: TouchEvent) => {
      endMeasure(e);
      endScrub();
    };
    box.addEventListener("touchstart", onTouchStart, { passive: true });
    box.addEventListener("touchmove", onTouchMove, { passive: false });
    box.addEventListener("touchend", onTouchEnd);
    box.addEventListener("touchcancel", onTouchEnd);
    box.addEventListener("mouseleave", endScrub);

    return () => {
      cancelled = true;
      ro.disconnect();
      box.removeEventListener("touchstart", onTouchStart);
      box.removeEventListener("touchmove", onTouchMove);
      box.removeEventListener("touchend", onTouchEnd);
      box.removeEventListener("touchcancel", onTouchEnd);
      box.removeEventListener("mouseleave", endScrub);
      chart.remove();
      chartRef.current = null;
    };
  }, [symbol, range]);

  const hasData = quote && isFinite(quote.price);
  // During pre/post-market the live tick includes extended trades; pin the
  // main line to the regular session close like TradingView.
  const live = ext ? ext.regPrice : hasData ? quote.price : NaN;
  const prev = ext ? ext.regPrevClose : hasData ? quote.prevClose : NaN;
  const chg = isFinite(live) ? (live - prev) * rate : NaN;
  const pct = isFinite(live) && prev ? ((live - prev) / prev) * 100 : NaN;
  const extDir = !ext || ext.chg === 0 ? "muted" : ext.chg > 0 ? "up" : "down";

  // Period P&L: live price (falling back to the last candle) vs period start.
  const pLive = isFinite(live) ? live : period ? period.last : NaN;
  const pChg = period && period.base ? (pLive - period.base) * rate : NaN;
  const pPct = period && period.base ? ((pLive - period.base) / period.base) * 100 : NaN;
  const pDir = !isFinite(pChg) || pChg === 0 ? "muted" : pChg > 0 ? "up" : "down";
  const crypto = isCrypto(symbol);
  const name = stats?.name || profile?.name || "";

  // While scrubbing, the header shows the pointed candle's price and its change
  // since the start of the visible range; otherwise the live values.
  const dispPrice = scrub ? scrub.c : live;
  const scrubChg = scrub && period?.base ? (scrub.c - period.base) * rate : NaN;
  const scrubPct = scrub && period?.base ? ((scrub.c - period.base) / period.base) * 100 : NaN;
  const dispChg = scrub ? scrubChg : chg;
  const dispPct = scrub ? scrubPct : pct;
  const dispDir = !isFinite(dispChg) || dispChg === 0 ? "muted" : dispChg > 0 ? "up" : "down";

  // Two-finger measure: open of the earlier candle (a) to close of the later
  // one (b), matching TradingView's O→C convention.
  const mDelta = measure ? (measure.b.close - measure.a.open) * rate : NaN;
  const mPct = measure && measure.a.open ? ((measure.b.close - measure.a.open) / measure.a.open) * 100 : NaN;
  const mDir = !isFinite(mDelta) || mDelta === 0 ? "muted" : mDelta > 0 ? "up" : "down";

  return (
    <div className="chart-modal">
      <div className="chart-hdr">
        <div className="chart-id">
          <Avatar symbol={symbol} logo={profile?.logo} />
          <div>
            <div className="c-sym">
              {displaySymbol(symbol)}
              {stats?.exchange ? <span className="c-exch"> · {stats.exchange}</span> : null}
            </div>
            <div className="c-price">
              {isFinite(dispPrice) ? fmtPrice(dispPrice * rate) : "—"}{" "}
              <span className={dispDir}>
                {isFinite(dispChg) ? `${fmtChange(dispChg)} ${fmtPct(dispPct)}` : ""}
              </span>
              {scrub ? (
                <span className="muted"> · {fmtScrubTime(scrub.time, intraday)}</span>
              ) : (
                <>
                  {ext && <span className="muted"> at close</span>}
                  {shownCcy && <span className="muted"> · {shownCcy}</span>}
                </>
              )}
            </div>
            {scrub && !measure && (
              <div className="c-ohlc">
                <span>O<b>{fmtPrice(scrub.o * rate)}</b></span>
                <span>H<b>{fmtPrice(scrub.h * rate)}</b></span>
                <span>L<b>{fmtPrice(scrub.l * rate)}</b></span>
                <span>C<b>{fmtPrice(scrub.c * rate)}</b></span>
              </div>
            )}
            {ext && (
              <div className={`c-period ${extDir}`}>
                <span className={`ext-ico ${ext.state}`}>{ext.state === "pre" ? "☀" : "☾"}</span>{" "}
                {fmtPrice(ext.price * rate)} {fmtChange(ext.chg * rate)} {fmtPct(ext.pct)}
              </div>
            )}
            {range !== "1D" && isFinite(pChg) && (
              <div className={`c-period ${pDir}`}>
                {fmtChange(pChg)} {fmtPct(pPct)} {PERIOD_LABEL[range]}
              </div>
            )}
          </div>
        </div>
        <div className="chart-hdr-actions">
          <button className="lists-btn" onClick={() => setShowLists(true)}>
            Lists
          </button>
          <button className="close-x" onClick={onClose} aria-label="Close chart">
            ✕
          </button>
        </div>
      </div>
      <div className="chart-scroll">
        <div className="ranges">
          {RANGES.map((r) => (
            <button key={r} className={r === range ? "on" : ""} onClick={() => pickRange(r)}>
              {r}
            </button>
          ))}
        </div>
        <div className="chart-box">
          {/* Dedicated host: lightweight-charts owns this div's children. React
              must never render into the same container, or its reconciler can
              sweep the chart's foreign DOM out (prod-only, on msg toggle). */}
          <div className="chart-host" ref={boxRef} />
          {msg && <div className="chart-msg">{msg}</div>}
          {measure && (
            <div className="measure">
              <div className="m-line" style={{ left: measure.a.x }} />
              <div className="m-line" style={{ left: measure.b.x }} />
              <div className="m-pills">
                <div className="m-pill">
                  <span className="m-v">
                    <span className="m-k">O</span>
                    {fmtPrice(measure.a.open * rate)}
                  </span>
                  <span className="m-t">{fmtScrubTime(measure.a.time, intraday)}</span>
                </div>
                <div className={`m-pill ${mDir}`}>
                  <span className="m-v">{fmtChange(mDelta)}</span>
                  <span className="m-sub">{fmtPct(mPct)}</span>
                </div>
                <div className="m-pill">
                  <span className="m-v">
                    <span className="m-k">C</span>
                    {fmtPrice(measure.b.close * rate)}
                  </span>
                  <span className="m-t">{fmtScrubTime(measure.b.time, intraday)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
        {name && <div className="c-name">{name}</div>}
        {/* Binance pairs have no issuer behind them — no statements, no news. */}
        {!crypto && (
          <div className="dtabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? "on" : ""}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        {(crypto || tab === "Overview") && (
        <div className="stats">
          <h2>Key stats</h2>
          <div className="stat-list">
          {stats ? (
            crypto ? (
              <>
                <StatRow label="24h high" value={fmtPrice((stats.dayHigh ?? NaN) * rate)} />
                <StatRow label="24h low" value={fmtPrice((stats.dayLow ?? NaN) * rate)} />
                <StatRow label={`Volume (${cryptoBase(symbol)})`} value={fmtBig(stats.volume)} />
                <StatRow label="Volume (quote)" value={fmtBig(stats.marketCap)} />
              </>
            ) : (
              <>
                <StatRow label="Volume" value={fmtBig(stats.volume)} />
                <StatRow label="Average volume (3M)" value={fmtBig(stats.avgVol3M)} />
                <StatRow
                  label="Market cap"
                  value={
                    stats.marketCap
                      ? `${fmtBig(stats.marketCap)}${stats.currency ? " " + stats.currency : ""}`
                      : "—"
                  }
                />
                {/* Price rows carry the same conversion as the header so they
                    stay comparable with it. */}
                <StatRow label="Day range" value={
                  stats.dayLow != null && stats.dayHigh != null
                    ? `${fmtPrice(stats.dayLow * rate)} – ${fmtPrice(stats.dayHigh * rate)}`
                    : "—"
                } />
                <StatRow label="52W range" value={
                  stats.low52 != null && stats.high52 != null
                    ? `${fmtPrice(stats.low52 * rate)} – ${fmtPrice(stats.high52 * rate)}`
                    : "—"
                } />
                <StatRow label="Beta (1Y)" value={stats.beta != null ? stats.beta.toFixed(3) : "—"} />
                <StatRow label="P/E (TTM)" value={stats.peTTM != null ? stats.peTTM.toFixed(2) : "—"} />
                <StatRow label="EPS (TTM)" value={stats.epsTTM != null ? fmtPrice(stats.epsTTM * rate) : "—"} />
                <StatRow
                  label="Dividend yield"
                  value={stats.dividendYield != null ? stats.dividendYield.toFixed(2) + "%" : "—"}
                />
              </>
            )
          ) : (
            <div className="stat-row">
              <span className="muted">Loading…</span>
              <span />
            </div>
          )}
          </div>
        </div>
        )}
        {!crypto && tab === "Overview" && (
          <TickerOverview
            symbol={symbol}
            rate={rate}
            currency={shownCcy ?? currency}
            live={live}
          />
        )}
        {!crypto && tab === "Financials" && <FinancialsTab symbol={symbol} />}
        {!crypto && tab === "News" && <NewsTab symbol={symbol} name={name} />}
        {/* The Financials and News tabs carry their own source line. */}
        {(crypto || tab === "Overview") && (
          <div className="empty-hint" style={{ padding: "8px 20px 24px" }}>
            {crypto ? "Binance · 24h change basis" : "Chart in native currency · Yahoo Finance"}
          </div>
        )}
      </div>
      {showLists && <ListsSheet symbol={symbol} onClose={() => setShowLists(false)} />}
    </div>
  );
}
