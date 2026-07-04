"use client";
import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, type IChartApi } from "lightweight-charts";
import { useQuotes, useWatchlist, tabsWithSymbol } from "@/lib/store";
import { fmtPrice, fmtChange, fmtPct, fmtBig } from "@/lib/format";
import { isCrypto, cryptoPair, cryptoBase, displaySymbol } from "@/lib/crypto";
import { Avatar } from "./Avatar";

const RANGES = ["1D", "1W", "1M", "6M", "1Y", "5Y"] as const;

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
  const [range, setRange] = useState<(typeof RANGES)[number]>("1D");
  const [msg, setMsg] = useState("Loading…");
  const [stats, setStats] = useState<Stats | null>(null);
  const [showLists, setShowLists] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const quote = useQuotes((s) => s.quotes[symbol]);
  const profile = useQuotes((s) => s.profiles[symbol]);
  const currency = useWatchlist((s) => s.currency);
  const sgdRate = useQuotes((s) => s.sgdRate);
  const rate = currency === "SGD" && sgdRate ? sgdRate : 1;

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

    let cancelled = false;
    setMsg("Loading…");
    fetchCandles(symbol, range)
      .then((d: any) => {
        if (cancelled) return;
        if (!d.candles?.length) {
          setMsg(d.error ? `No chart data (${d.error})` : "No chart data");
          return;
        }
        series.setData(d.candles);
        chart.timeScale().fitContent();
        setMsg("");
      })
      .catch(() => !cancelled && setMsg("Failed to load chart"));

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: box.clientWidth, height: box.clientHeight });
    });
    ro.observe(box);

    return () => {
      cancelled = true;
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [symbol, range]);

  const hasData = quote && isFinite(quote.price);
  const chg = hasData ? (quote.price - quote.prevClose) * rate : NaN;
  const pct = hasData && quote.prevClose ? ((quote.price - quote.prevClose) / quote.prevClose) * 100 : NaN;
  const dir = !isFinite(chg) || chg === 0 ? "muted" : chg > 0 ? "up" : "down";
  const crypto = isCrypto(symbol);
  const name = stats?.name || profile?.name || "";

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
              {hasData ? fmtPrice(quote.price * rate) : "—"}{" "}
              <span className={dir}>
                {isFinite(chg) ? `${fmtChange(chg)} ${fmtPct(pct)}` : ""}
              </span>
              <span className="muted"> · {currency}</span>
            </div>
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
            <button key={r} className={r === range ? "on" : ""} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
        <div className="chart-box" ref={boxRef}>
          {msg && <div className="chart-msg">{msg}</div>}
        </div>
        {name && <div className="c-name">{name}</div>}
        <div className="stats">
          <h2>Key stats</h2>
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
                <StatRow label="Day range" value={
                  stats.dayLow != null && stats.dayHigh != null
                    ? `${fmtPrice(stats.dayLow)} – ${fmtPrice(stats.dayHigh)}`
                    : "—"
                } />
                <StatRow label="52W range" value={
                  stats.low52 != null && stats.high52 != null
                    ? `${fmtPrice(stats.low52)} – ${fmtPrice(stats.high52)}`
                    : "—"
                } />
                <StatRow label="Beta (1Y)" value={stats.beta != null ? stats.beta.toFixed(3) : "—"} />
                <StatRow label="P/E (TTM)" value={stats.peTTM != null ? stats.peTTM.toFixed(2) : "—"} />
                <StatRow label="EPS (TTM)" value={stats.epsTTM != null ? fmtPrice(stats.epsTTM) : "—"} />
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
        <div className="empty-hint" style={{ padding: "8px 20px 24px" }}>
          {crypto ? "Binance · 24h change basis" : "Chart in native currency · Yahoo Finance"}
        </div>
      </div>
      {showLists && <ListsSheet symbol={symbol} onClose={() => setShowLists(false)} />}
    </div>
  );
}
