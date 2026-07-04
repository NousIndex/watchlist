import { NextResponse } from "next/server";

export async function GET() {
  try {
    const r = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=SGD", {
      next: { revalidate: 3600 },
    });
    const d = await r.json();
    const rate = d?.rates?.SGD;
    if (typeof rate === "number") return NextResponse.json({ rate });
  } catch {}
  return NextResponse.json({ rate: null }, { status: 502 });
}
