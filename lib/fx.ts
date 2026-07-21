/**
 * Currency conversion for display.
 *
 * Symbols are quoted in their listing's own currency — D05.SI in SGD, 000660.KS
 * in KRW — so the USD/SGD toggle can't just multiply everything by one rate.
 * Each value is converted from its native currency via USD.
 *
 * Where no rate exists for a currency (Frankfurter is ECB-based and has no TWD,
 * for one) the value stays in its native currency and is labelled as such,
 * rather than being silently mislabelled.
 */

/** 1 USD = n units of the currency. USD itself is always 1. */
export type FxRates = Record<string, number>;

/**
 * Sub-units some exchanges quote in: LSE prices many lines in pence, not
 * pounds. Yahoo signals this with a lowercase final letter ("GBp").
 */
const SUBUNIT: Record<string, [string, number]> = {
  GBp: ["GBP", 100],
  ZAc: ["ZAR", 100],
  ILA: ["ILS", 100],
};

/** Instrument types where a currency conversion is meaningless. */
const UNCONVERTIBLE = new Set(["INDEX", "CURRENCY"]);

export interface Conversion {
  /** Multiply a native-currency value by this to get the display value. */
  factor: number;
  /** Currency the result is in — may be the native one if no rate existed. */
  ccy: string | null;
}

/**
 * Work out how to show `native` money in `target`.
 * `quoteType` suppresses conversion for index levels and FX pairs, which are
 * numbers rather than prices.
 */
export function convertTo(
  native: string | null | undefined,
  target: string,
  rates: FxRates | null,
  quoteType?: string | null
): Conversion {
  // Index points and FX rates aren't money — never convert, never label.
  if (quoteType && UNCONVERTIBLE.has(quoteType)) return { factor: 1, ccy: null };

  // Unknown currency: assume the value is already USD (true for most of the
  // list) and fall back to plain toggle behaviour until the batch fills it in.
  if (!native) {
    const r = rates?.[target];
    return r && target !== "USD" ? { factor: r, ccy: target } : { factor: 1, ccy: "USD" };
  }

  const [base, div] = SUBUNIT[native] ?? [native, 1];
  const toBase = 1 / div;
  if (base === target) return { factor: toBase, ccy: target };

  const from = base === "USD" ? 1 : rates?.[base];
  const to = target === "USD" ? 1 : rates?.[target];
  // No rate for one side — show it natively rather than mislabel it.
  if (!from || !to) return { factor: toBase, ccy: base };

  return { factor: toBase * (to / from), ccy: target };
}
