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
