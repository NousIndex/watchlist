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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Calendar dates arrive as "yyyy-mm-dd" and mean that day everywhere — parsing
 * them into a Date would re-interpret them in the viewer's timezone and can
 * shift the day, so split the string instead.
 */
export function dateParts(iso: string): { day: string; month: string; year: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const mi = Number(m[2]) - 1;
  if (mi < 0 || mi > 11) return null;
  return { day: String(Number(m[3])), month: MONTHS[mi], year: m[1] };
}

/** "Today", "Tomorrow", "in 5 days", "3 days ago" — relative to the local day. */
export function relativeDay(iso: string): string {
  const p = dateParts(iso);
  if (!p) return "";
  const now = new Date();
  // Compare calendar days, not instants: both sides are midnight UTC.
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const target = Date.UTC(Number(p.year), MONTHS.indexOf(p.month), Number(p.day));
  const days = Math.round((target - today) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 0) return days < 7 ? `in ${days} days` : `in ${Math.round(days / 7)} weeks`;
  const ago = -days;
  return ago < 7 ? `${ago} days ago` : `${Math.round(ago / 7)} weeks ago`;
}

/** Deterministic pastel-ish color for a ticker's fallback avatar. */
export function symbolColor(symbol: string): string {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 45% 32%)`;
}
