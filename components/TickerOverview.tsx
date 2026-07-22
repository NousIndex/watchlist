"use client";
import { useEffect, useState } from "react";
import type { Detail, EventKind } from "@/lib/types";
import { dateParts, relativeDay, fmtPrice, fmtPct, fmtBig } from "@/lib/format";
import { isCrypto } from "@/lib/crypto";

/**
 * Revolut-style overview below the chart: upcoming events, an "About" blurb,
 * quick facts, and analyst coverage. Everything is optional — Yahoo only
 * returns what applies to the instrument, so each block hides itself when the
 * data isn't there rather than rendering an empty shell.
 */

const EVENT_LABEL: Record<EventKind, string> = {
  earnings: "Earnings call",
  exdiv: "Ex-dividend",
  dividend: "Dividend paid",
};

const CONSENSUS_LABEL: Record<string, string> = {
  strong_buy: "Strong buy",
  buy: "Buy",
  hold: "Hold",
  sell: "Sell",
  strong_sell: "Strong sell",
  underperform: "Underperform",
  outperform: "Outperform",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ov-sec">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function EventCard({ kind, date, estimated }: { kind: EventKind; date: string; estimated?: boolean }) {
  const p = dateParts(date);
  if (!p) return null;
  return (
    <div className="ev-card">
      <div className="ev-date">
        <span className="ev-day">{p.day}</span>
        <span className="ev-mon">{p.month}</span>
      </div>
      <div className={`ev-pill ${kind}`}>
        <span className="ev-name">{EVENT_LABEL[kind]}</span>
        <span className="ev-when">
          {relativeDay(date)}
          {estimated ? " · estimated" : ""}
        </span>
      </div>
    </div>
  );
}

function About({ summary, name }: { summary: string; name: string | null }) {
  const [open, setOpen] = useState(false);
  // ~260 chars is roughly four lines on a phone — enough to be useful collapsed.
  const long = summary.length > 260;
  const shown = open || !long ? summary : summary.slice(0, 260).trimEnd() + "…";
  return (
    <Section title={name ? `About ${name}` : "About"}>
      <div className="ov-card">
        <p className="ov-text">{shown}</p>
        {long && (
          <button className="ov-more" onClick={() => setOpen((v) => !v)}>
            {open ? "See less" : "See more"}
          </button>
        )}
      </div>
    </Section>
  );
}

function Ratings({
  d,
  rate,
  currency,
  live,
}: {
  d: Detail;
  rate: number;
  currency: string;
  live: number;
}) {
  const a = d.analysts;
  if (!a) return null;
  const pct = (n: number) => (a.total ? (n / a.total) * 100 : 0);
  const buy = pct(a.strongBuy + a.buy);
  const hold = pct(a.hold);
  const sell = pct(a.sell + a.strongSell);
  const bars: { label: string; value: number; cls: string }[] = [
    { label: "Buy", value: buy, cls: "buy" },
    { label: "Hold", value: hold, cls: "hold" },
    { label: "Sell", value: sell, cls: "sell" },
  ];
  const consensus = a.consensus ? CONSENSUS_LABEL[a.consensus] ?? a.consensus : "—";

  return (
    <Section title="Analyst ratings & price targets">
      <div className="ov-grid">
        <div className="ov-card">
          <div className="ov-label">
            Consensus · {a.total} analyst{a.total === 1 ? "" : "s"}
          </div>
          <div className="ov-big">{consensus}</div>
          <div className="rt-bars">
            {bars.map((b) => (
              <div key={b.label} className="rt-bar">
                <div className="rt-track">
                  <div className={`rt-fill ${b.cls}`} style={{ width: `${b.value}%` }} />
                </div>
                <span className="rt-lab">
                  {Math.round(b.value)}% {b.label}
                </span>
              </div>
            ))}
          </div>
        </div>
        {a.targetMean != null && (
          <div className="ov-card">
            <div className="ov-label">1y avg price target</div>
            <div className="ov-big">{fmtPrice(a.targetMean * rate)}</div>
            {/* Upside vs the live price — the number that makes a target mean
                something. Both sides are native currency, so no rate needed. */}
            {isFinite(live) && live > 0 ? (
              <div className={`ov-sub ${a.targetMean > live ? "up" : "down"}`}>
                {fmtPct(((a.targetMean - live) / live) * 100)}
                <span className="muted"> · {currency}</span>
              </div>
            ) : (
              <div className="ov-label" style={{ marginTop: 2 }}>
                {currency}
              </div>
            )}
            {a.targetLow != null && a.targetHigh != null && (
              <div className="rt-range">
                <span>{fmtPrice(a.targetLow * rate)}</span>
                <span className="muted">low · high</span>
                <span>{fmtPrice(a.targetHigh * rate)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

export function TickerOverview({
  symbol,
  rate,
  currency,
  live,
}: {
  symbol: string;
  rate: number;
  currency: string;
  /** Live price in native currency, for the price-target upside. */
  live: number;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    // Binance pairs have no Yahoo profile to fetch.
    if (isCrypto(symbol)) {
      setState("done");
      setDetail(null);
      return;
    }
    let cancelled = false;
    setState("loading");
    setDetail(null);
    fetch(`/api/detail?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Detail) => {
        if (cancelled) return;
        setDetail(d);
        setState("done");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (state === "loading") return <div className="ov-msg">Loading details…</div>;
  if (!detail) return null;

  const facts: { label: string; value: string }[] = [];
  if (detail.sector) facts.push({ label: "Sector", value: detail.sector });
  if (detail.industry) facts.push({ label: "Industry", value: detail.industry });
  if (detail.country) facts.push({ label: "Country", value: detail.country });
  if (detail.employees) facts.push({ label: "Employees", value: fmtBig(detail.employees) });
  if (detail.fundFamily) facts.push({ label: "Provider", value: detail.fundFamily });
  if (detail.category) facts.push({ label: "Category", value: detail.category });
  if (detail.revenueGrowth != null)
    facts.push({ label: "Revenue growth", value: fmtPct(detail.revenueGrowth * 100) });
  if (detail.profitMargins != null)
    facts.push({ label: "Profit margin", value: fmtPct(detail.profitMargins * 100) });

  const hasAnything =
    detail.events.length || detail.summary || facts.length || detail.analysts || detail.holdings.length;
  if (!hasAnything) return null;

  return (
    <div className="overview">
      {detail.holdings.length > 0 && (
        <Section title="Top holdings">
          <div className="ov-card">
            {detail.holdings.map((h) => (
              <div key={h.symbol + h.name} className="ov-fact">
                <span>{h.symbol || h.name}</span>
                <span>{h.pct.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {detail.events.length > 0 && (
        <Section title="Events">
          <div className="ev-list">
            {detail.events.map((e) => (
              <EventCard key={e.kind + e.date} {...e} />
            ))}
          </div>
        </Section>
      )}

      <Ratings d={detail} rate={rate} currency={currency} live={live} />

      {detail.summary && <About summary={detail.summary} name={detail.name} />}

      {facts.length > 0 && (
        <Section title="Quick facts">
          <div className="ov-card">
            {facts.map((f) => (
              <div key={f.label} className="ov-fact">
                <span>{f.label}</span>
                <span>{f.value}</span>
              </div>
            ))}
            {detail.website && (
              <a className="ov-link" href={detail.website} target="_blank" rel="noreferrer">
                {detail.website.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
              </a>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}
