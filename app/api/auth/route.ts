import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({ password: "" }));
  const expected = process.env.APP_PASSWORD;
  if (!expected) return NextResponse.json({ ok: true });
  if (password !== expected) {
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("sw_auth", expected, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return res;
}
