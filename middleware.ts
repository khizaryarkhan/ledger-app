import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isAuth = !!req.auth;
  const path = req.nextUrl.pathname;

  const isPublic = path === "/login" || path.startsWith("/api/auth") || path === "/api/qbo/callback" || path === "/api/gmail/callback" || path === "/api/debug-auth";
  const isCron = path.startsWith("/api/cron");
  const isApi = path.startsWith("/api/");

  if (isCron) return NextResponse.next();
  if (isPublic) {
    if (isAuth && (path === "/login" || path === "/register")) {
      return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
    }
    return NextResponse.next();
  }
  if (!isAuth) {
    if (isApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if (path === "/") return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
