export interface Quote {
  price: number;      // last price
  prevClose: number;  // previous session close
  ts: number;         // last update (ms)
}

/** Extended-hours (pre/post-market) snapshot for a symbol. */
export interface ExtQuote {
  state: "pre" | "post";
  price: number;
  chg: number; // pre: vs previous close · post: vs regular close
  pct: number;
  // Regular session close + its previous close: while a symbol is in an
  // extended session the main line is pinned to these (TradingView behavior)
  // instead of the live tick, which includes extended-hours trades.
  regPrice: number;
  regPrevClose: number;
}

export interface Profile {
  logo: string;
  name: string;
}

/* ---------------- Ticker detail (profile / events / analysts) ---------------- */

export type EventKind = "earnings" | "exdiv" | "dividend";

export interface TickerEvent {
  kind: EventKind;
  /** ISO yyyy-mm-dd, interpreted as a calendar date (no timezone shifting). */
  date: string;
  /** Yahoo flags earnings dates it has inferred rather than confirmed. */
  estimated?: boolean;
}

export interface AnalystRatings {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  total: number;
  /** Yahoo's recommendationKey, e.g. "strong_buy". */
  consensus: string | null;
  targetMean: number | null;
  targetHigh: number | null;
  targetLow: number | null;
}

export interface Holding {
  symbol: string;
  name: string;
  pct: number;
}

/* ---------------- Financials ---------------- */

/** One reporting period. Missing line items are null, never 0. */
export interface FinPeriod {
  /** "2025" for annual, "Q1 '26" for quarterly. */
  label: string;
  revenue: number | null;
  netIncome: number | null;
  assets: number | null;
  liabilities: number | null;
  operating: number | null;
  investing: number | null;
  financing: number | null;
  freeCashFlow: number | null;
}

export interface EpsPoint {
  label: string;
  actual: number | null;
  estimate: number | null;
}

export interface Financials {
  currency: string | null;
  annual: FinPeriod[];
  quarterly: FinPeriod[];
  eps: EpsPoint[];
}

/* ---------------- News ---------------- */

export interface NewsItem {
  id: string;
  title: string;
  publisher: string;
  link: string;
  /** Epoch seconds. */
  published: number;
  thumbnail: string | null;
}

export interface Detail {
  /** EQUITY | ETF | INDEX | FUTURE | CRYPTOCURRENCY | CURRENCY | … */
  type: string | null;
  name: string | null;
  summary: string | null;
  // Equities
  sector: string | null;
  industry: string | null;
  country: string | null;
  employees: number | null;
  website: string | null;
  // Funds
  fundFamily: string | null;
  category: string | null;
  holdings: Holding[];
  // Everything else
  events: TickerEvent[];
  analysts: AnalystRatings | null;
  revenueGrowth: number | null;
  profitMargins: number | null;
  epsForward: number | null;
}

export interface Section {
  id: string;
  name: string | null; // null = unnamed default section (no header rendered)
  symbols: string[];
}

export interface Tab {
  id: string;
  name: string;
  sections: Section[];
}
