"use client";
import { useQuotes, useWatchlist, allSymbols } from "./store";
import { isCrypto, isYahooOnly, cryptoPair, CRYPTO_PREFIX } from "./crypto";

/**
 * QuoteEngine
 *
 * Stocks/ETFs:
 * - Bootstrap: the extended-hours poll (one batched Yahoo call, on start and
 *   every 30s) carries regular prices + names, filling every row at once.
 *   Non-US listings, indices, futures and FX (isYahooOnly) live entirely on
 *   this poll — Finnhub's free tier can't quote them.
 * - Finnhub rate-limited REST queue (~46/min, under the 60/min free cap;
 *   search shares the budget) keeps US quotes fresh. Priority: visible &
 *   unloaded > visible & stale > visible missing profile > unloaded >
 *   off-screen stale > missing profiles.
 * - Websocket streams trades for visible rows (free cap: 50 subs).
 *
 * Crypto (Binance public API, no key, browser-direct):
 * - One batched REST call every 10s covers ALL crypto symbols at once.
 * - Websocket miniTicker streams visible pairs live (~1s ticks).
 */

const TICK_MS = 1300;
const VISIBLE_STALE_MS = 15_000;
const HIDDEN_STALE_MS = 90_000;
const MAX_WS_SUBS = 45;
const CRYPTO_POLL_MS = 10_000;
const EXT_POLL_MS = 30_000; // batched Yahoo snapshot (server caches 25s)
const BATCH_FRESH_MS = 25_000; // batch bootstrap won't overwrite quotes newer than this
const FX_POLL_MS = 3_600_000; // USD->SGD drifts slowly; hourly is plenty

class QuoteEngine {
  private started = false;
  private visible = new Set<string>();
  private inflight = new Set<string>();
  /** Symbols whose profile came back empty this session — retry next session, not next tick. */
  private profileEmpty = new Set<string>();
  private observer: IntersectionObserver | null = null;
  private elSymbol = new WeakMap<Element, string>();
  private subDebounce: ReturnType<typeof setTimeout> | null = null;

  // Finnhub
  private fhWs: WebSocket | null = null;
  private fhToken: string | null = null;
  private fhSubs = new Set<string>();
  private fhRetry = 1000;

  // Binance
  private bnWs: WebSocket | null = null;
  private bnSubs = new Set<string>(); // lowercase pairs
  private bnRetry = 1000;
  private bnMsgId = 1;

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const sym = this.elSymbol.get(e.target);
          if (!sym) continue;
          if (e.isIntersecting) this.visible.add(sym);
          else this.visible.delete(sym);
        }
        this.queueSubSync();
      },
      { rootMargin: "100px" }
    );

    setInterval(() => this.tick(), TICK_MS);
    setInterval(() => this.pollCrypto(), CRYPTO_POLL_MS);
    setInterval(() => this.pollExtended(), EXT_POLL_MS);
    setInterval(() => this.fetchFx(), FX_POLL_MS);
    this.pollCrypto();
    this.pollExtended();
    this.connectFinnhub();
    this.connectBinance();
    this.fetchFx();

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this.tick();
        this.pollCrypto();
        this.pollExtended();
        this.fetchFx(); // cheap: server caches the upstream an hour
      }
    });
  }

  observe(el: Element, symbol: string) {
    this.elSymbol.set(el, symbol);
    this.observer?.observe(el);
  }
  unobserve(el: Element) {
    const sym = this.elSymbol.get(el);
    if (sym) this.visible.delete(sym);
    this.observer?.unobserve(el);
    this.queueSubSync();
  }

  /* ---------------- Finnhub REST queue (stocks only) ---------------- */

  private pickNext(): { kind: "quote" | "profile"; symbol: string } | null {
    const { quotes, profiles } = useQuotes.getState();
    // Yahoo-only symbols are excluded: Finnhub would just miss and the queue
    // slot is wasted — the batched poll owns them (quote + name).
    const syms = allSymbols(useWatchlist.getState().tabs).filter(
      (s) => !isCrypto(s) && !isYahooOnly(s)
    );
    const now = Date.now();
    const age = (s: string) => now - (quotes[s]?.ts ?? 0);
    const fresh = (s: string, ms: number) => quotes[s] && age(s) < ms;
    const busy = (s: string) => this.inflight.has(s);
    // Empty persisted profiles count as missing (a failed run shouldn't stick
    // forever), but only one retry per session via profileEmpty.
    const needsProfile = (s: string) =>
      (!profiles[s] || (!profiles[s].name && !profiles[s].logo)) &&
      !this.profileEmpty.has(s) &&
      !busy(s + ":p");

    for (const s of syms)
      if (this.visible.has(s) && !quotes[s] && !busy(s)) return { kind: "quote", symbol: s };
    for (const s of syms)
      if (this.visible.has(s) && !fresh(s, VISIBLE_STALE_MS) && !busy(s))
        return { kind: "quote", symbol: s };
    // Visible profiles before off-screen quotes: with enough symbols the quote
    // refresh cycle never drains, so low-priority profiles would starve forever.
    for (const s of syms)
      if (this.visible.has(s) && needsProfile(s)) return { kind: "profile", symbol: s };
    for (const s of syms) if (!quotes[s] && !busy(s)) return { kind: "quote", symbol: s };
    for (const s of syms)
      if (!fresh(s, HIDDEN_STALE_MS) && !busy(s)) return { kind: "quote", symbol: s };
    for (const s of syms) if (needsProfile(s)) return { kind: "profile", symbol: s };
    return null;
  }

  private async tick() {
    if (document.hidden) return;
    const job = this.pickNext();
    if (!job) return;
    const key = job.kind === "profile" ? job.symbol + ":p" : job.symbol;
    this.inflight.add(key);
    try {
      if (job.kind === "quote") {
        const r = await fetch(`/api/quote?symbol=${encodeURIComponent(job.symbol)}`);
        if (r.ok) {
          const d = await r.json();
          if (d && typeof d.c === "number" && d.c > 0) {
            useQuotes.getState().setQuote(job.symbol, {
              price: d.c,
              prevClose: d.pc || d.c,
              ts: Date.now(),
            });
          } else {
            useQuotes.getState().setQuote(job.symbol, {
              price: NaN,
              prevClose: NaN,
              ts: Date.now(),
            });
          }
        }
      } else {
        const r = await fetch(`/api/profile?symbol=${encodeURIComponent(job.symbol)}`);
        if (r.ok) {
          const d = await r.json();
          if (d.logo || d.name) {
            useQuotes.getState().setProfile(job.symbol, {
              logo: d.logo || "",
              name: d.name || "",
            });
          } else {
            this.profileEmpty.add(job.symbol);
          }
        }
      }
    } catch {
      /* retry next tick */
    } finally {
      this.inflight.delete(key);
    }
  }

  /* ---------------- Binance batched REST (all crypto) ---------------- */

  private async pollCrypto() {
    if (document.hidden) return;
    const pairs = allSymbols(useWatchlist.getState().tabs)
      .filter(isCrypto)
      .map(cryptoPair);
    if (pairs.length === 0) return;
    try {
      const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(
        JSON.stringify(pairs)
      )}`;
      const r = await fetch(url);
      if (!r.ok) return;
      const d: any[] = await r.json();
      const st = useQuotes.getState();
      const now = Date.now();
      for (const t of d) {
        const price = parseFloat(t.lastPrice);
        const change = parseFloat(t.priceChange);
        if (isFinite(price)) {
          st.setQuote(CRYPTO_PREFIX + t.symbol, {
            price,
            prevClose: price - (isFinite(change) ? change : 0), // 24h-ago basis
            ts: now,
          });
        }
      }
    } catch {}
  }

  /* --------- Extended hours + batched bootstrap — one Yahoo call --------- */

  private async pollExtended() {
    if (document.hidden) return;
    // Binance crypto has its own batched poll; Yahoo-sourced crypto (AKT-USD)
    // rides along here for the regular-price bootstrap (it never has ext data).
    const syms = allSymbols(useWatchlist.getState().tabs).filter((s) => !isCrypto(s));
    if (syms.length === 0) return;
    try {
      const r = await fetch(`/api/extended?symbols=${encodeURIComponent(syms.join(","))}`);
      if (!r.ok) return;
      const d = await r.json();
      const st = useQuotes.getState();
      if (d && typeof d.ext === "object" && d.ext) st.setExt(d.ext);
      // Batched regular prices: fills every row in one round trip on load,
      // then tops up whatever the Finnhub queue hasn't reached. Skip anything
      // updated recently — a live websocket tick beats Yahoo's snapshot.
      if (d && typeof d.reg === "object" && d.reg) {
        const now = Date.now();
        const batch: Record<string, { price: number; prevClose: number; ts: number }> = {};
        const names: Record<string, string> = {};
        for (const [sym, q] of Object.entries<any>(d.reg)) {
          if (typeof q.n === "string" && q.n && q.n !== st.names[sym]) names[sym] = q.n;
          const cur = st.quotes[sym];
          if (cur && now - cur.ts < BATCH_FRESH_MS) continue;
          if (typeof q.c === "number" && q.c > 0)
            batch[sym] = { price: q.c, prevClose: q.pc || q.c, ts: now };
        }
        if (Object.keys(batch).length) st.setQuotes(batch);
        if (Object.keys(names).length) st.setNames(names);
      }
    } catch {}
  }

  private async fetchFx() {
    try {
      const r = await fetch("/api/fx");
      if (r.ok) {
        const d = await r.json();
        if (d.rate) useQuotes.getState().setSgdRate(d.rate);
      }
    } catch {}
  }

  /* ---------------- Finnhub websocket ---------------- */

  private async connectFinnhub() {
    try {
      if (!this.fhToken) {
        const r = await fetch("/api/ws-token");
        if (!r.ok) throw new Error("no token");
        this.fhToken = (await r.json()).token;
      }
      const ws = new WebSocket(`wss://ws.finnhub.io/?token=${this.fhToken}`);
      this.fhWs = ws;
      ws.onopen = () => {
        this.fhRetry = 1000;
        this.fhSubs.clear();
        this.syncSubs();
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "trade" && Array.isArray(msg.data)) {
            const latest: Record<string, { p: number; t: number }> = {};
            for (const t of msg.data) latest[t.s] = { p: t.p, t: t.t };
            const st = useQuotes.getState();
            for (const [s, v] of Object.entries(latest)) st.setPrice(s, v.p, v.t);
          }
        } catch {}
      };
      ws.onclose = () => {
        this.fhWs = null;
        this.fhSubs.clear();
        setTimeout(() => this.connectFinnhub(), this.fhRetry);
        this.fhRetry = Math.min(this.fhRetry * 2, 30_000);
      };
      ws.onerror = () => ws.close();
    } catch {
      setTimeout(() => this.connectFinnhub(), this.fhRetry);
      this.fhRetry = Math.min(this.fhRetry * 2, 30_000);
    }
  }

  /* ---------------- Binance websocket ---------------- */

  private connectBinance() {
    try {
      const ws = new WebSocket("wss://stream.binance.com:9443/ws");
      this.bnWs = ws;
      ws.onopen = () => {
        this.bnRetry = 1000;
        this.bnSubs.clear();
        this.syncSubs();
      };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.e === "24hrMiniTicker" && m.s) {
            const price = parseFloat(m.c);
            const open = parseFloat(m.o);
            if (isFinite(price)) {
              useQuotes.getState().setQuote(CRYPTO_PREFIX + m.s, {
                price,
                prevClose: isFinite(open) ? open : price,
                ts: Date.now(),
              });
            }
          }
        } catch {}
      };
      ws.onclose = () => {
        this.bnWs = null;
        this.bnSubs.clear();
        setTimeout(() => this.connectBinance(), this.bnRetry);
        this.bnRetry = Math.min(this.bnRetry * 2, 30_000);
      };
      ws.onerror = () => ws.close();
    } catch {
      setTimeout(() => this.connectBinance(), this.bnRetry);
      this.bnRetry = Math.min(this.bnRetry * 2, 30_000);
    }
  }

  /* ---------------- Subscription sync (both sockets) ---------------- */

  private queueSubSync() {
    if (this.subDebounce) clearTimeout(this.subDebounce);
    this.subDebounce = setTimeout(() => this.syncSubs(), 400);
  }

  private syncSubs() {
    const vis = Array.from(this.visible);

    // Finnhub: visible non-crypto
    if (this.fhWs && this.fhWs.readyState === WebSocket.OPEN) {
      const desired = new Set(vis.filter((s) => !isCrypto(s)).slice(0, MAX_WS_SUBS));
      for (const s of Array.from(this.fhSubs))
        if (!desired.has(s)) {
          this.fhWs.send(JSON.stringify({ type: "unsubscribe", symbol: s }));
          this.fhSubs.delete(s);
        }
      for (const s of Array.from(desired))
        if (!this.fhSubs.has(s)) {
          this.fhWs.send(JSON.stringify({ type: "subscribe", symbol: s }));
          this.fhSubs.add(s);
        }
    }

    // Binance: visible crypto pairs (lowercase stream names)
    if (this.bnWs && this.bnWs.readyState === WebSocket.OPEN) {
      const desired = new Set(
        vis.filter(isCrypto).map((s) => cryptoPair(s).toLowerCase())
      );
      const unsub = Array.from(this.bnSubs).filter((p) => !desired.has(p));
      const sub = Array.from(desired).filter((p) => !this.bnSubs.has(p));
      if (unsub.length) {
        this.bnWs.send(
          JSON.stringify({
            method: "UNSUBSCRIBE",
            params: unsub.map((p) => `${p}@miniTicker`),
            id: this.bnMsgId++,
          })
        );
        for (const p of unsub) this.bnSubs.delete(p);
      }
      if (sub.length) {
        this.bnWs.send(
          JSON.stringify({
            method: "SUBSCRIBE",
            params: sub.map((p) => `${p}@miniTicker`),
            id: this.bnMsgId++,
          })
        );
        for (const p of sub) this.bnSubs.add(p);
      }
    }
  }
}

export const engine = new QuoteEngine();
