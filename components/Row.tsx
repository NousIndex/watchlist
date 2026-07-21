"use client";
import { memo, useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuotes, useWatchlist } from "@/lib/store";
import { engine } from "@/lib/engine";
import { fmtPrice, fmtChange, fmtPct } from "@/lib/format";
import { isCrypto, isYahooCrypto, displaySymbol } from "@/lib/crypto";
import { convertTo } from "@/lib/fx";
import { Avatar } from "./Avatar";

interface Props {
  symbol: string;
  editMode: boolean;
  onOpen: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}

function RowInner({ symbol, editMode, onOpen, onRemove }: Props) {
  const quote = useQuotes((s) => s.quotes[symbol]);
  const ext = useQuotes((s) => s.ext[symbol]);
  const profile = useQuotes((s) => s.profiles[symbol]);
  const batchName = useQuotes((s) => s.names[symbol]);
  const currency = useWatchlist((s) => s.currency);
  const fxRates = useQuotes((s) => s.fxRates);
  const meta = useQuotes((s) => s.meta[symbol]);

  const ref = useRef<HTMLDivElement | null>(null);
  const prevPrice = useRef<number | null>(null);
  const [flash, setFlash] = useState<"" | "flash-up" | "flash-down">("");

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: symbol,
    disabled: !editMode,
  });

  // viewport registration for websocket subs + REST priority
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    engine.observe(el, symbol);
    return () => engine.unobserve(el);
  }, [symbol]);

  // flash on tick
  useEffect(() => {
    if (!quote || !isFinite(quote.price)) return;
    // While pinned to the regular close (pre/post-market) the displayed price
    // doesn't move, so a flash would be misleading — just track the tick.
    if (ext) {
      prevPrice.current = quote.price;
      return;
    }
    if (prevPrice.current !== null && quote.price !== prevPrice.current) {
      setFlash(quote.price > prevPrice.current ? "flash-up" : "flash-down");
      const t = setTimeout(() => setFlash(""), 400);
      prevPrice.current = quote.price;
      return () => clearTimeout(t);
    }
    prevPrice.current = quote.price;
  }, [quote, ext]);

  // Convert from the listing's own currency, not by assuming everything is USD.
  const rate = convertTo(meta?.cc, currency, fxRates, meta?.qt).factor;
  const hasData = quote && isFinite(quote.price);
  // During pre/post-market the live tick includes extended trades; pin the
  // main line to the regular session close like TradingView.
  const live = ext ? ext.regPrice : hasData ? quote.price : NaN;
  const prev = ext ? ext.regPrevClose : hasData ? quote.prevClose : NaN;
  const price = isFinite(live) ? live * rate : NaN;
  const chg = isFinite(live) ? (live - prev) * rate : NaN;
  const pct = isFinite(live) && prev ? ((live - prev) / prev) * 100 : NaN;
  const dir = !isFinite(chg) || chg === 0 ? "muted" : chg > 0 ? "up" : "down";
  const extDir = !ext || ext.chg === 0 ? "muted" : ext.chg > 0 ? "up" : "down";

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      className={`row${isDragging ? " dragging" : ""}`}
      ref={(el) => {
        setNodeRef(el);
        ref.current = el;
      }}
      style={style}
      onClick={() => !editMode && onOpen(symbol)}
      {...(editMode ? { ...attributes, ...listeners } : {})}
    >
      {editMode && (
        <button
          className="remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(symbol);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Remove ${symbol}`}
        >
          ⊖
        </button>
      )}
      <Avatar symbol={symbol} logo={profile?.logo} />
      <div className="mid">
        <div className="sym">{displaySymbol(symbol)}</div>
        <div className="name">
          {isCrypto(symbol) ? "Binance · 24h" : isYahooCrypto(symbol) ? "Crypto · Yahoo" : profile?.name || batchName || "\u00a0"}
        </div>
      </div>
      <div className="right">
        <div className={`price ${flash}`}>{fmtPrice(price)}</div>
        <div className={`chg ${dir}`}>
          {isFinite(chg) ? `${fmtChange(chg)}  ${fmtPct(pct)}` : quote ? "no data" : "…"}
        </div>
        {ext && (
          <div className={`ext ${extDir}`}>
            <span className={`ext-ico ${ext.state}`}>{ext.state === "pre" ? "☀" : "☾"}</span>{" "}
            {fmtPrice(ext.price * rate)} {fmtChange(ext.chg * rate)} {fmtPct(ext.pct)}
          </div>
        )}
      </div>
      {editMode && <span className="handle">≡</span>}
    </div>
  );
}

export const Row = memo(RowInner);
