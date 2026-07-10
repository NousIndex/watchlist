import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Quote, Profile, ExtQuote, Section, Tab } from "./types";

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Virtual tab showing every symbol across all tabs. Not stored; always rendered last. */
export const ALL_TAB_ID = "__all__";

/* ---------------- Watchlist structure ---------------- */

interface WatchlistState {
  tabs: Tab[];
  activeTabId: string;
  currency: "USD" | "SGD";
  editMode: boolean;

  setActiveTab: (id: string) => void;
  setCurrency: (c: "USD" | "SGD") => void;
  setEditMode: (v: boolean) => void;

  addTab: (name: string) => void;
  renameTab: (id: string, name: string) => void;
  deleteTab: (id: string) => void;
  reorderTabs: (fromId: string, toId: string) => void;

  addSection: (tabId: string, name: string) => void;
  renameSection: (tabId: string, sectionId: string, name: string) => void;
  deleteSection: (tabId: string, sectionId: string) => void;
  moveSection: (tabId: string, sectionId: string, dir: -1 | 1) => void;

  addSymbol: (tabId: string, sectionId: string, symbol: string) => void;
  removeSymbol: (tabId: string, symbol: string) => void;
  /** Add to the tab's first section if absent, remove from the tab if present. */
  toggleSymbolInTab: (tabId: string, symbol: string) => void;
  moveSymbol: (tabId: string, symbol: string, toSectionId: string, toIndex: number) => void;
}

const emptyTab = (): Tab => ({
  id: uid(),
  name: "My list",
  sections: [{ id: uid(), name: null, symbols: [] }],
});

const bn = (pairs: string[]) => pairs.map((p) => "BINANCE:" + p + "USDT");

/** Seed watchlists (from the user's TradingView / broker / CoinMarketCap lists). */
const defaultTabs = (): Tab[] => [
  {
    id: uid(),
    name: "Main",
    sections: [
      { id: uid(), name: null, symbols: ["SPYL.L", "^GSPC", "VWRA.L", "QQQ", "^NDX", "YMAX"] },
      {
        id: uid(),
        name: "Stocks",
        symbols: [
          "PYPL", "AMD", "AAPL", "NVDA", "TSLA", "GOOG", "D05.SI", "LUNR", "RKLB",
          "PL", "IONQ", "RGTI", "QBTS", "QUBT", "ORCL", "ADBE",
        ],
      },
      {
        id: uid(),
        name: "Macro",
        symbols: ["SGD=X", "GC=F", "CL=F", "BINANCE:BTCUSDT", "^TNX", "MCHI"],
      },
    ],
  },
  {
    id: uid(),
    name: "Portfolio",
    sections: [
      {
        id: uid(),
        name: null,
        symbols: [
          "YMAX", "CRWV", "LUNR", "TMC", "SYM", "OKLO", "QUBT", "RKLB", "ORCL",
          "SOFI", "RGTI", "QBTS", "IONQ", "PL", "HDB", "QYLD", "C6L.SI", "SE", "SPYL.L",
        ],
      },
    ],
  },
  {
    id: uid(),
    name: "Watching",
    sections: [
      { id: uid(), name: null, symbols: ["TQQQ", "C38U.SI", "N2IU.SI", "J69U.SI", "DELL", "SATA"] },
    ],
  },
  {
    id: uid(),
    name: "Buy List",
    sections: [
      {
        id: uid(),
        name: null,
        symbols: [
          "CRWV", "TMC", "SYM", "LUNR", "OKLO", "QUBT", "RKLB", "TSM", "ASML",
          "MELI", "CCJ", "SMR", "MP", "BWXT", "USAR", "KTOS", "AVAV", "000660.KS",
          "BKSY", "SATA", "PL", "HDB", "SE", "2454.TW", "SNDK", "OUST", "CEG",
          "TLN", "VST", "ISRG", "TER", "APLD", "SOFI",
        ],
      },
    ],
  },
  {
    id: uid(),
    name: "Crypto",
    sections: [
      {
        id: uid(),
        name: null,
        // AKT / SWEAT aren't on Binance; they ride the Yahoo path as XXX-USD.
        symbols: [
          ...bn([
            "BTC", "ETH", "BNB", "SOL", "TRX", "ADA", "SUI", "NEAR", "SHIB",
            "DOT", "ICP", "LUNC", "PYTH", "FLOKI",
          ]),
          "AKT-USD",
          "SWEAT-USD",
        ],
      },
    ],
  },
  {
    id: uid(),
    name: "Potential",
    sections: [
      {
        id: uid(),
        name: null,
        symbols: [...bn(["TAO", "ONDO", "PYTH", "PENDLE"]), "AKT-USD", ...bn(["HNT"])],
      },
    ],
  },
];

export const useWatchlist = create<WatchlistState>()(
  persist(
    (set, get) => ({
      tabs: defaultTabs(),
      activeTabId: "",
      currency: "USD",
      editMode: false,

      setActiveTab: (id) => set({ activeTabId: id }),
      setCurrency: (c) => set({ currency: c }),
      setEditMode: (v) => set({ editMode: v }),

      addTab: (name) => {
        const t: Tab = { id: uid(), name, sections: [{ id: uid(), name: null, symbols: [] }] };
        set((s) => ({ tabs: [...s.tabs, t], activeTabId: t.id }));
      },
      renameTab: (id, name) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, name } : t)) })),
      deleteTab: (id) =>
        set((s) => {
          const tabs = s.tabs.filter((t) => t.id !== id);
          if (tabs.length === 0) tabs.push(emptyTab());
          const activeTabId = s.activeTabId === id ? tabs[0].id : s.activeTabId;
          return { tabs, activeTabId };
        }),
      reorderTabs: (fromId, toId) =>
        set((s) => {
          const tabs = [...s.tabs];
          const from = tabs.findIndex((t) => t.id === fromId);
          const to = tabs.findIndex((t) => t.id === toId);
          if (from < 0 || to < 0) return {};
          const [moved] = tabs.splice(from, 1);
          tabs.splice(to, 0, moved);
          return { tabs };
        }),

      addSection: (tabId, name) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId
              ? { ...t, sections: [...t.sections, { id: uid(), name, symbols: [] }] }
              : t
          ),
        })),
      renameSection: (tabId, sectionId, name) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  sections: t.sections.map((sec) =>
                    sec.id === sectionId ? { ...sec, name } : sec
                  ),
                }
              : t
          ),
        })),
      deleteSection: (tabId, sectionId) =>
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.id !== tabId) return t;
            let sections = t.sections.filter((sec) => sec.id !== sectionId);
            if (sections.length === 0) sections = [{ id: uid(), name: null, symbols: [] }];
            return { ...t, sections };
          }),
        })),
      moveSection: (tabId, sectionId, dir) =>
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.id !== tabId) return t;
            const sections = [...t.sections];
            const i = sections.findIndex((sec) => sec.id === sectionId);
            const j = i + dir;
            if (i < 0 || j < 0 || j >= sections.length) return t;
            [sections[i], sections[j]] = [sections[j], sections[i]];
            return { ...t, sections };
          }),
        })),

      addSymbol: (tabId, sectionId, symbol) =>
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.id !== tabId) return t;
            if (t.sections.some((sec) => sec.symbols.includes(symbol))) return t; // unique per tab
            return {
              ...t,
              sections: t.sections.map((sec) =>
                sec.id === sectionId ? { ...sec, symbols: [...sec.symbols, symbol] } : sec
              ),
            };
          }),
        })),
      removeSymbol: (tabId, symbol) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  sections: t.sections.map((sec) => ({
                    ...sec,
                    symbols: sec.symbols.filter((x) => x !== symbol),
                  })),
                }
              : t
          ),
        })),
      toggleSymbolInTab: (tabId, symbol) =>
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.id !== tabId) return t;
            const has = t.sections.some((sec) => sec.symbols.includes(symbol));
            if (has) {
              return {
                ...t,
                sections: t.sections.map((sec) => ({
                  ...sec,
                  symbols: sec.symbols.filter((x) => x !== symbol),
                })),
              };
            }
            return {
              ...t,
              sections: t.sections.map((sec, i) =>
                i === 0 ? { ...sec, symbols: [...sec.symbols, symbol] } : sec
              ),
            };
          }),
        })),
      moveSymbol: (tabId, symbol, toSectionId, toIndex) =>
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.id !== tabId) return t;
            const sections = t.sections.map((sec) => ({
              ...sec,
              symbols: sec.symbols.filter((x) => x !== symbol),
            }));
            const target = sections.find((sec) => sec.id === toSectionId);
            if (!target) return t;
            const i = Math.max(0, Math.min(toIndex, target.symbols.length));
            target.symbols.splice(i, 0, symbol);
            return { ...t, sections };
          }),
        })),
    }),
    {
      name: "sw-watchlist",
      version: 2,
      // v0 -> v1: bring in the seed watchlists for browsers that already have
      // saved state, skipping any tab name the user already has.
      // v1 -> v2: QBTS into Portfolio; AKT/SWEAT (Yahoo-sourced) into the coin tabs.
      migrate: (persisted: any, version) => {
        if (!persisted?.tabs) return persisted;
        if (version === 0) {
          const have = new Set(persisted.tabs.map((t: Tab) => t.name));
          const oldDefaultSymbols =
            "SPY,QQQ,YMAX,PYPL,AMD,AAPL,NVDA,TSLA,BINANCE:BTCUSDT,BINANCE:ETHUSDT";
          const isOldDefault =
            persisted.tabs.length === 1 &&
            persisted.tabs[0].name === "My list" &&
            persisted.tabs[0].sections
              .flatMap((sec: Section) => sec.symbols)
              .join(",") === oldDefaultSymbols;
          if (isOldDefault) {
            persisted.tabs = defaultTabs();
          } else {
            for (const t of defaultTabs()) if (!have.has(t.name)) persisted.tabs.push(t);
          }
        }
        if (version <= 1) {
          const addTo = (tabName: string, symbol: string, afterSym?: string) => {
            const tab = persisted.tabs.find((t: Tab) => t.name === tabName);
            if (!tab || tab.sections.some((sec: Section) => sec.symbols.includes(symbol))) return;
            const sec =
              (afterSym &&
                tab.sections.find((s: Section) => s.symbols.includes(afterSym))) ||
              tab.sections[0];
            if (!sec) return;
            const i = afterSym ? sec.symbols.indexOf(afterSym) : -1;
            if (i >= 0) sec.symbols.splice(i + 1, 0, symbol);
            else sec.symbols.push(symbol);
          };
          addTo("Portfolio", "QBTS", "RGTI");
          addTo("Crypto", "AKT-USD", "BINANCE:FLOKIUSDT");
          addTo("Crypto", "SWEAT-USD", "AKT-USD");
          addTo("Potential", "AKT-USD", "BINANCE:PENDLEUSDT");
        }
        return persisted;
      },
      onRehydrateStorage: () => (state) => {
        if (
          state &&
          state.activeTabId !== ALL_TAB_ID &&
          !state.tabs.some((t) => t.id === state.activeTabId)
        ) {
          state.setActiveTab(state.tabs[0]?.id ?? "");
        }
      },
    }
  )
);

/** All unique symbols across all tabs. */
export function allSymbols(tabs: Tab[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tabs)
    for (const sec of t.sections)
      for (const sym of sec.symbols)
        if (!seen.has(sym)) {
          seen.add(sym);
          out.push(sym);
        }
  return out;
}

/** Synthesized read-only "All" tab: every symbol, grouped by its source tab. */
export function buildAllTab(tabs: Tab[]): Tab {
  const seen = new Set<string>();
  const sections: Section[] = [];
  for (const t of tabs) {
    const symbols: string[] = [];
    for (const sec of t.sections)
      for (const sym of sec.symbols)
        if (!seen.has(sym)) {
          seen.add(sym);
          symbols.push(sym);
        }
    if (symbols.length) sections.push({ id: ALL_TAB_ID + ":" + t.id, name: t.name, symbols });
  }
  if (sections.length === 0) sections.push({ id: ALL_TAB_ID + ":empty", name: null, symbols: [] });
  return { id: ALL_TAB_ID, name: "All", sections };
}

/** Ids of tabs that contain the symbol. */
export function tabsWithSymbol(tabs: Tab[], symbol: string): Set<string> {
  const out = new Set<string>();
  for (const t of tabs)
    if (t.sections.some((sec) => sec.symbols.includes(symbol))) out.add(t.id);
  return out;
}

/* ---------------- Quotes / profiles cache ---------------- */

interface QuoteState {
  quotes: Record<string, Quote>;
  profiles: Record<string, Profile>;
  ext: Record<string, ExtQuote>; // symbols currently in pre/post-market
  sgdRate: number | null; // USD -> SGD
  setQuote: (symbol: string, q: Quote) => void;
  setPrice: (symbol: string, price: number, ts: number) => void;
  setProfile: (symbol: string, p: Profile) => void;
  /** Full replace: symbols that left pre/post-market drop off the map. */
  setExt: (ext: Record<string, ExtQuote>) => void;
  setSgdRate: (r: number) => void;
}

export const useQuotes = create<QuoteState>()(
  persist(
    (set) => ({
      quotes: {},
      profiles: {},
      ext: {},
      sgdRate: null,
      setQuote: (symbol, q) => set((s) => ({ quotes: { ...s.quotes, [symbol]: q } })),
      setPrice: (symbol, price, ts) =>
        set((s) => {
          const prev = s.quotes[symbol];
          if (!prev) return {};
          return { quotes: { ...s.quotes, [symbol]: { ...prev, price, ts } } };
        }),
      setProfile: (symbol, p) => set((s) => ({ profiles: { ...s.profiles, [symbol]: p } })),
      setExt: (ext) => set({ ext }),
      setSgdRate: (r) => set({ sgdRate: r }),
    }),
    {
      name: "sw-quotes",
      // ext is session data: persisting it would resurrect a stale pre/post
      // line on reload. The engine re-polls it right after start anyway.
      partialize: (s) =>
        ({ quotes: s.quotes, profiles: s.profiles, sgdRate: s.sgdRate }) as any,
    }
  )
);
