"use client";
import { useEffect, useState } from "react";
import { symbolColor } from "@/lib/format";
import { isCrypto, isYahooCrypto, cryptoBase, displaySymbol } from "@/lib/crypto";

/**
 * Parqet's free logo CDN covers ETFs, non-US listings and crypto — everything
 * Finnhub's free profile2 endpoint (stocks only) can't. 404s for unknown
 * symbols, so a broken guess falls through to the letter avatar via onError.
 */
function parqetUrl(symbol: string): string | null {
  if (isCrypto(symbol))
    return `https://assets.parqet.com/logos/crypto/${cryptoBase(symbol)}?format=png`;
  if (isYahooCrypto(symbol))
    return `https://assets.parqet.com/logos/crypto/${symbol.slice(0, -4)}?format=png`;
  if (/[\^=]/.test(symbol)) return null; // indices / FX / futures have no logo
  return `https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol)}?format=png`;
}

interface Props {
  symbol: string;
  /** Finnhub logo from the cached profile, if any. */
  logo?: string;
}

export function Avatar({ symbol, logo }: Props) {
  const candidates = [logo, parqetUrl(symbol)].filter(Boolean) as string[];
  const [failed, setFailed] = useState(0);
  useEffect(() => setFailed(0), [symbol, logo]);
  const src = candidates[failed];

  return (
    <div className="avatar" style={{ background: symbolColor(symbol) }}>
      {src ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed((n) => n + 1)} />
      ) : isCrypto(symbol) ? (
        cryptoBase(symbol).slice(0, 4)
      ) : (
        displaySymbol(symbol).replace(/\..*$/, "").slice(0, 4)
      )}
    </div>
  );
}
