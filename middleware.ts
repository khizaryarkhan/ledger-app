import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isAuth = !!req.auth;
  const path = req.nextUrl.pathname;
  const role = (req.auth?.user as any)?.role;

  // ── *.vercel.app → "under development in Foodready" placeholder ─────────────
  // The auto-generated Vercel URL shows a coming-soon page so the app isn't
  // browsable there. The real domain (primeaccountax.com) serves the app
  // normally. /api/* is left alone so webhooks, cron, and OAuth callbacks work.
  const host = req.headers.get("host") || "";
  if (
    process.env.VERCEL_ENV === "production" &&
    host.endsWith(".vercel.app") &&
    !path.startsWith("/api/")
  ) {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Foodready — Coming soon</title><style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0c0a09;color:#fafaf9;padding:24px}
      .card{max-width:520px;text-align:center}
      .badge{display:inline-block;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#a8a29e;border:1px solid #292524;border-radius:999px;padding:6px 14px;margin-bottom:28px}
      h1{font-size:30px;font-weight:700;line-height:1.25;margin-bottom:14px}
      p{font-size:16px;line-height:1.6;color:#d6d3d1}
      .brand{color:#34d399;font-weight:600}
      .foot{margin-top:32px;font-size:13px;color:#78716c}
    </style></head><body><div class="card">
      <span class="badge">Coming soon</span>
      <h1>Receivable flows are now under development in <span class="brand">Foodready</span></h1>
      <p>This module is being built into the Foodready platform. Check back soon.</p>
      <div class="foot">Foodready</div>
    </div></body></html>`;
    return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  // Customer Response Portal — public, token-authenticated (no login)
  const isPortal = path.startsWith("/portal/") || path.startsWith("/api/portal/");
  const isLegal = path === "/privacy" || path === "/terms";
  const isHome = path === "/"; // public marketing landing (Google verification needs this)
  const isPublic = isHome || path === "/login" || path.startsWith("/api/auth") || path === "/api/qbo/callback" || path === "/api/gmail/callback" || path === "/api/microsoft/callback" || path === "/api/debug-auth" || isPortal || isLegal;
  const isCron = path.startsWith("/api/cron") || path.startsWith("/api/webhooks");
  const isApi = path.startsWith("/api/");
  const isRepPortal = path === "/rep-portal" || path.startsWith("/rep-portal/");

  if (isCron) return NextResponse.next();

  if (isPublic) {
    if (isAuth) {
      // Logged-in users skip the login page and go straight to the app.
      // ("/" is the public marketing site — everyone can view it.)
      if (path === "/login" || path === "/register") {
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
