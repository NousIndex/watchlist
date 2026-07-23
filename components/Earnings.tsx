"use client";
import { useEffect, useMemo, useState } from "react";
import { useWatchlist, useQuotes, allSymbols } from "@/lib/store";
import { dateParts, relativeDay } from "@/lib/format";
import { displaySymbol } from "@/lib/crypto";
import { Avatar } from "./Avatar";
import type { EarningsItem } from "@/app/api/earnings/route";

/**
 * A single calendar of every upcoming earnings call across all watchlist
 * tabs, soonest first and grouped by month. Sits beside the USD/SGD toggle as
 * its own view; unlike the per-ticker "Events" card it spans the whole list.
 */

function MonthHeading({ iso }: { iso: string }) {
  const p = dateParts(iso);
  if (!p) return null;
  return <h2 className="ern-month">{p.month} {p.year}</h2>;
}

function EarningsRow({ item }: { item: EarningsItem }) {
  const profile = useQuotes((s) => s.profiles[item.symbol]);
  const p = dateParts(item.date);
  if (!p) return null;
  return (
    <div className="ern-row">
      <div className="ern-date">
        <span className="ern-day">{p.day}</span>
        <span className="ern-mon">{p.month}</span>
      </div>
      <Avatar symbol={item.symbol} logo={profile?.logo} />
      <div className="ern-body">
        <span className="ern-sym">{displaySymbol(item.symbol)}</span>
        {item.name && <span className="ern-name">{item.name}</span>}
      </div>
      <span className="ern-when">
        {relativeDay(item.date)}
        {item.estimated ? " · est." : ""}
      </span>
    </div>
  );
}

export function Earnings() {
  const tabs = useWatchlist((s) => s.tabs);
  const symbols = useMemo(() => allSymbols(tabs), [tabs]);
  const [items, setItems] = useState<EarningsItem[] | null>(null);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetch(`/api/earnings?symbols=${encodeURIComponent(symbols.join(","))}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { items: EarningsItem[] }) => {
        if (cancelled) return;
        setItems(d.items);
        setState("done");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [symbols]);

  if (state === "loading") return <div className="ov-msg">Loading earnings dates…</div>;
  if (state === "error") return <div className="ov-msg">Couldn’t load earnings dates.</div>;
  if (!items || items.length === 0)
    return <div className="ov-msg">No upcoming earnings calls for your tracked tickers.</div>;

  // Break the flat, date-sorted list into month groups for the headings.
  const groups: { key: string; items: EarningsItem[] }[] = [];
  for (const item of items) {
    const key = item.date.slice(0, 7); // yyyy-mm
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }

  return (
    <div className="earnings">
      {groups.map((g) => (
        <section key={g.key} className="ern-group">
          <MonthHeading iso={g.items[0].date} />
          <div className="ern-list">
            {g.items.map((it) => (
              <EarningsRow key={it.symbol} item={it} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
