import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next(); // no password configured -> open

  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/auth") return NextResponse.next();

  const cookie = req.cookies.get("sw_auth")?.value;
  if (cookie === password) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon-192.png|icon-512.png|manifest.webmanifest).*)"],
};
