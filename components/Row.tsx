"use client";
import { memo, useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuotes, useWatchlist } from "@/lib/store";
import { engine } from "@/lib/engine";
import { fmtPrice, fmtChange, fmtPct, symbolColor } from "@/lib/format";
import { isCrypto, isYahooCrypto, cryptoBase, displaySymbol } from "@/lib/crypto";

interface Props {
  symbol: string;
  editMode: boolean;
  onOpen: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}

function RowInner({ symbol, editMode, onOpen, onRemove }: Props) {
  const quote = useQuotes((s) => s.quotes[symbol]);
  const profile = useQuotes((s) => s.profiles[symbol]);
  const currency = useWatchlist((s) => s.currency);
  const sgdRate = useQuotes((s) => s.sgdRate);

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
    if (prevPrice.current !== null && quote.price !== prevPrice.current) {
      setFlash(quote.price > prevPrice.current ? "flash-up" : "flash-down");
      const t = setTimeout(() => setFlash(""), 400);
      prevPrice.current = quote.price;
      return () => clearTimeout(t);
    }
    prevPrice.current = quote.price;
  }, [quote]);

  const rate = currency === "SGD" && sgdRate ? sgdRate : 1;
  const hasData = quote && isFinite(quote.price);
  const price = hasData ? quote.price * rate : NaN;
  const chg = hasData ? (quote.price - quote.prevClose) * rate : NaN;
  const pct = hasData && quote.prevClose ? ((quote.price - quote.prevClose) / quote.prevClose) * 100 : NaN;
  const dir = !isFinite(chg) || chg === 0 ? "muted" : chg > 0 ? "up" : "down";

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
      <div className="avatar" style={{ background: symbolColor(symbol) }}>
        {profile?.logo ? (
          <img src={profile.logo} alt="" loading="lazy" />
        ) : isCrypto(symbol) ? (
          cryptoBase(symbol).slice(0, 4)
        ) : (
          displaySymbol(symbol).replace(/\..*$/, "").slice(0, 4)
        )}
      </div>
      <div className="mid">
        <div className="sym">{displaySymbol(symbol)}</div>
        <div className="name">
          {isCrypto(symbol) ? "Binance · 24h" : isYahooCrypto(symbol) ? "Crypto · Yahoo" : profile?.name ||"\u00a0"}
        </div>
      </div>
      <div className="right">
        <div className={`price ${flash}`}>{fmtPrice(price)}</div>
        <div className={`chg ${dir}`}>
          {isFinite(chg) ? `${fmtChange(chg)}  ${fmtPct(pct)}` : quote ? "no data" : "…"}
        </div>
      </div>
      {editMode && <span className="handle">≡</span>}
    </div>
  );
}

export const Row = memo(RowInner);
