import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isAuth = !!req.auth;
  const path = req.nextUrl.pathname;
  const role = (req.auth?.user as any)?.role;

  // ── Canonical-domain redirect ──────────────────────────────────────────────
  // Send the auto-generated *.vercel.app pages to the real domain so the app
  // isn't browsable on the Vercel URL. API routes are left alone so webhooks,
  // cron, and OAuth callbacks still work on any host.
  const host = req.headers.get("host") || "";
  const canonicalHost = process.env.CANONICAL_HOST || "primeaccountax.com";
  if (
    process.env.VERCEL_ENV === "production" &&
    host.endsWith(".vercel.app") &&
    !path.startsWith("/api/")
  ) {
    const url = new URL(req.nextUrl);
    url.protocol = "https:";
    url.host = canonicalHost;
    return NextResponse.redirect(url, 308);
  }

  // Customer Response Portal — public, token-authenticated (no login)
  const isPortal = path.startsWith("/portal/") || path.startsWith("/api/portal/");
  const isPublic = path === "/login" || path.startsWith("/api/auth") || path === "/api/qbo/callback" || path === "/api/gmail/callback" || path === "/api/microsoft/callback" || path === "/api/debug-auth" || isPortal;
  const isCron = path.startsWith("/api/cron") || path.startsWith("/api/webhooks");
  const isApi = path.startsWith("/api/");
  const isRepPortal = path === "/rep-portal" || path.startsWith("/rep-portal/");

  if (isCron) return NextResponse.next();

  if (isPublic) {
    if (isAuth) {
      if (path === "/login" || path === "/register") {
        // Redirect reps to their portal, others to dashboard
        const dest = role === "rep" ? "/rep-portal" : "/dashboard";
        return NextResponse.redirect(new URL(dest, req.nextUrl));
      }
    }
    return NextResponse.next();
  }

  if (!isAuth) {
    if (isApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  // Rep users can only access /rep-portal and /api routes
  if (role === "rep") {
    if (!isRepPortal && !isApi) {
      return NextResponse.redirect(new URL("/rep-portal", req.nextUrl));
    }
    return NextResponse.next();
  }

  // Non-rep admin/users cannot access rep portal
  if (isRepPortal && role !== "rep") {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  if (path === "/") return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
