"use client";
import { useEffect, useState } from "react";
import type { Financials as Fin, FinPeriod } from "@/lib/types";
import { fmtBig, fmtPct } from "@/lib/format";
import { BarChart, type BarSeries } from "./BarChart";

/**
 * Financial statements, Revolut-style. One Annual/Quarterly control scopes
 * every card (per-card filters are an anti-pattern — all charts should
 * re-render against the same slice).
 *
 * Colors are categorical slots 1–3 of the validated dark palette; the trio
 * passes the all-pairs CVD and normal-vision gates against this card surface.
 */
const SERIES_1 = "#3987e5";
const SERIES_2 = "#d95926";
const SERIES_3 = "#199e70";

function Card({
  title,
  stat,
  children,
}: {
  title: string;
  stat?: { label: string; value: string } | null;
  children: React.ReactNode;
}) {
  return (
    <section className="ov-sec">
      <h2>{title}</h2>
      <div className="ov-card">
        {stat && (
          <div className="fin-stat">
            {stat.label}: <strong>{stat.value}</strong>
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

export function FinancialsTab({ symbol }: { symbol: string }) {
  const [fin, setFin] = useState<Fin | null>(null);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [quarterly, setQuarterly] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [epsSel, setEpsSel] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setFin(null);
    setSel(null);
    fetch(`/api/financials?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Fin) => {
        if (cancelled) return;
        setFin(d);
        setState("done");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (state === "loading") return <div className="ov-msg">Loading financials…</div>;
  if (state === "error" || !fin) return <div className="ov-msg">Financials unavailable.</div>;

  const rows: FinPeriod[] = quarterly ? fin.quarterly : fin.annual;
  const hasRows = rows.length > 0;
  const hasEps = fin.eps.length > 0;

  if (!hasRows && !hasEps) {
    return (
      <div className="ov-msg">
        No financial statements published for this instrument — funds, indices and
        commodities don&apos;t report them.
      </div>
    );
  }

  // Default to the most recent period; clamp when switching Annual/Quarterly.
  const i = Math.min(sel ?? rows.length - 1, Math.max(0, rows.length - 1));
  const cur: FinPeriod | undefined = rows[i];
  const labels = rows.map((r) => r.label);
  const cur$ = (v: number) => fmtBig(v);

  const series = (defs: { key: keyof FinPeriod; label: string; color: string }[]): BarSeries[] =>
    defs
      .map((d) => ({
        key: String(d.key),
        label: d.label,
        color: d.color,
        values: rows.map((r) => r[d.key] as number | null),
      }))
      .filter((s) => s.values.some((v) => v != null));

  const income = series([
    { key: "revenue", label: "Revenue", color: SERIES_1 },
    { key: "netIncome", label: "Net income", color: SERIES_2 },
  ]);
  const balance = series([
    { key: "assets", label: "Total assets", color: SERIES_1 },
    { key: "liabilities", label: "Total liabilities", color: SERIES_2 },
  ]);
  const cash = series([
    { key: "operating", label: "Operating", color: SERIES_1 },
    { key: "investing", label: "Investing", color: SERIES_2 },
    { key: "financing", label: "Financing", color: SERIES_3 },
  ]);

  const margin =
    cur?.revenue && cur.netIncome != null && cur.revenue !== 0
      ? (cur.netIncome / cur.revenue) * 100
      : null;
  const debtToAssets =
    cur?.assets && cur.liabilities != null && cur.assets !== 0
      ? (cur.liabilities / cur.assets) * 100
      : null;

  const epsSeries: BarSeries[] = [
    { key: "actual", label: "Actual EPS", color: SERIES_1, values: fin.eps.map((e) => e.actual) },
    { key: "estimate", label: "Estimated EPS", color: SERIES_2, values: fin.eps.map((e) => e.estimate) },
  ].filter((s) => s.values.some((v) => v != null));
  const epsIdx = Math.min(epsSel ?? fin.eps.length - 1, Math.max(0, fin.eps.length - 1));

  return (
    <div className="overview">
      {hasRows && (
        <div className="fin-toggle" role="group" aria-label="Reporting period">
          <button
            className={quarterly ? "" : "on"}
            onClick={() => {
              setQuarterly(false);
              setSel(null);
            }}
            aria-pressed={!quarterly}
          >
            Annual
          </button>
          <button
            className={quarterly ? "on" : ""}
            onClick={() => {
              setQuarterly(true);
              setSel(null);
            }}
            disabled={fin.quarterly.length === 0}
            aria-pressed={quarterly}
          >
            Quarterly
          </button>
        </div>
      )}

      {income.length > 0 && (
        <Card
          title="Income statement"
          stat={
            margin != null
              ? { label: `Profit margin · ${cur!.label}`, value: fmtPct(margin) }
              : null
          }
        >
          <BarChart
            periods={labels}
            series={income}
            format={cur$}
            selected={i}
            onSelect={setSel}
          />
        </Card>
      )}

      {balance.length > 0 && (
        <Card
          title="Balance sheet"
          stat={
            debtToAssets != null
              ? { label: `Debt to assets · ${cur!.label}`, value: debtToAssets.toFixed(1) + "%" }
              : null
          }
        >
          <BarChart
            periods={labels}
            series={balance}
            format={cur$}
            selected={i}
            onSelect={setSel}
          />
        </Card>
      )}

      {cash.length > 0 && (
        <Card
          title="Cash flow"
          stat={
            cur?.freeCashFlow != null
              ? { label: `Free cash flow · ${cur.label}`, value: fmtBig(cur.freeCashFlow) }
              : null
          }
        >
          <BarChart
            periods={labels}
            series={cash}
            format={cur$}
            selected={i}
            onSelect={setSel}
          />
        </Card>
      )}

      {epsSeries.length > 0 && (
        <Card title="Earnings per share">
          <BarChart
            periods={fin.eps.map((e) => e.label)}
            series={epsSeries}
            format={(v) => v.toFixed(2)}
            selected={epsIdx}
            onSelect={setEpsSel}
          />
        </Card>
      )}

      <div className="empty-hint" style={{ padding: "18px 0 4px", textAlign: "left" }}>
        Figures in {fin.currency ?? "reporting currency"} · Yahoo Finance
      </div>
    </div>
  );
}
