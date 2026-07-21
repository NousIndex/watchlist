import { NextResponse } from "next/server";

// Listings across the watchlist quote in their own currency, so one USD->SGD
// rate isn't enough. Frankfurter is ECB-based: majors are covered, a few (TWD)
// are not — missing currencies simply stay unconverted on the client.
const SYMBOLS = "SGD,EUR,GBP,HKD,JPY,KRW,CNY,AUD,CAD,CHF,INR,THB,MYR,IDR,PHP,NZD,SEK,NOK,DKK";

export async function GET() {
  try {
    const r = await fetch(
      `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${SYMBOLS}`,
      { next: { revalidate: 3600 } }
    );
    const d = await r.json();
    if (d?.rates && typeof d.rates === "object") {
      const rates: Record<string, number> = { USD: 1 };
      for (const [k, v] of Object.entries(d.rates)) {
        if (typeof v === "number" && isFinite(v) && v > 0) rates[k] = v;
      }
      // `rate` kept for older clients that only understand USD->SGD.
      return NextResponse.json({ rates, rate: rates.SGD ?? null });
    }
  } catch {}
  return NextResponse.json({ rates: null, rate: null }, { status: 502 });
}
