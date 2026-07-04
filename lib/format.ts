function decimalsFor(v: number): number {
  const a = Math.abs(v);
  if (a >= 20) return 2;
  if (a >= 0.1) return 3;
  if (a >= 0.001) return 5;
  return 8;
}

export function fmtPrice(v: number): string {
  if (!isFinite(v)) return "—";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimalsFor(v),
  });
}

export function fmtChange(v: number): string {
  if (!isFinite(v)) return "—";
  const dp = decimalsFor(v);
  const s = Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: dp,
  });
  return (v >= 0 ? "+" : "\u2212") + s;
}

export function fmtPct(v: number): string {
  if (!isFinite(v)) return "—";
  return (v >= 0 ? "+" : "\u2212") + Math.abs(v).toFixed(2) + "%";
}

/** Compact large numbers TradingView-style: 608.78 K, 17.61 B. */
export function fmtBig(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(2) + " T";
  if (a >= 1e9) return (v / 1e9).toFixed(2) + " B";
  if (a >= 1e6) return (v / 1e6).toFixed(2) + " M";
  if (a >= 1e3) return (v / 1e3).toFixed(2) + " K";
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Deterministic pastel-ish color for a ticker's fallback avatar. */
export function symbolColor(symbol: string): string {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 45% 32%)`;
}
