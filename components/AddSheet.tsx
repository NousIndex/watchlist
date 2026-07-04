"use client";
import { useEffect, useRef, useState } from "react";
import type { Tab } from "@/lib/types";
import { useWatchlist } from "@/lib/store";
import { searchCrypto } from "@/lib/crypto";

interface Result {
  symbol: string; // stored symbol (crypto results carry the BINANCE: prefix)
  display: string;
  description: string;
}

export function AddSheet({
  tab,
  pickTab,
  onClose,
}: {
  tab: Tab;
  /** When set (e.g. opened from the All tab), show these tabs as destinations. */
  pickTab?: Tab[];
  onClose: () => void;
}) {
  const addSymbol = useWatchlist((s) => s.addSymbol);
  const [source, setSource] = useState<"stocks" | "crypto">("stocks");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [targetTabId, setTargetTabId] = useState(tab.id);
  const targetTab = pickTab?.find((t) => t.id === targetTabId) ?? tab;
  const [targetSection, setTargetSection] = useState(targetTab.sections[0]?.id ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        if (source === "crypto") {
          const r = await searchCrypto(q);
          setResults(
            r.map((x) => ({ symbol: x.symbol, display: x.pair, description: x.description }))
          );
        } else {
          const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
          if (r.ok) {
            const d = await r.json();
            setResults(
              (d.result || []).map((x: any) => ({
                symbol: x.symbol,
                display: x.symbol,
                description: `${x.description}${x.type ? ` · ${x.type}` : ""}`,
              }))
            );
          }
        }
      } finally {
        setLoading(false);
      }
    }, 400);
  }, [q, source]);

  const existing = new Set(targetTab.sections.flatMap((s) => s.symbols));
  const sectionId = targetTab.sections.some((s) => s.id === targetSection)
    ? targetSection
    : targetTab.sections[0]?.id ?? "";

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-hdr">
          <span>Add symbol</span>
          <button onClick={onClose}>Done</button>
        </div>
        <div className="sheet-body">
          <div className="chips">
            <button className={source === "stocks" ? "on" : ""} onClick={() => setSource("stocks")}>
              Stocks / ETFs
            </button>
            <button className={source === "crypto" ? "on" : ""} onClick={() => setSource("crypto")}>
              Crypto
            </button>
          </div>
          <input
            className="search-input"
            placeholder={source === "crypto" ? "Search pair, e.g. BTC or TAOUSDT…" : "Search ticker or company…"}
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
          />
          {pickTab && pickTab.length > 1 && (
            <div className="chips">
              <span className="chip-label">Tab:</span>
              {pickTab.map((t) => (
                <button
                  key={t.id}
                  className={t.id === targetTab.id ? "on" : ""}
                  onClick={() => {
                    setTargetTabId(t.id);
                    setTargetSection(t.sections[0]?.id ?? "");
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
          {targetTab.sections.length > 1 && (
            <div className="chips">
              {pickTab && <span className="chip-label">Section:</span>}
              {targetTab.sections.map((s) => (
                <button
                  key={s.id}
                  className={s.id === sectionId ? "on" : ""}
                  onClick={() => setTargetSection(s.id)}
                >
                  {s.name ?? "Main"}
                </button>
              ))}
            </div>
          )}
          {loading && <div className="empty-hint">Searching…</div>}
          {!loading && q && results.length === 0 && <div className="empty-hint">No results</div>}
          {results.map((r) => (
            <div className="result" key={r.symbol}>
              <div style={{ minWidth: 0 }}>
                <div className="r-sym">{r.display}</div>
                <div className="r-desc">{r.description}</div>
              </div>
              <button
                disabled={existing.has(r.symbol)}
                onClick={() => addSymbol(targetTab.id, sectionId, r.symbol)}
              >
                {existing.has(r.symbol) ? "✓" : "+"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
