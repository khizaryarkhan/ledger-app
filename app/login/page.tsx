import { headers } from "next/headers";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { LoginForm } from "@/components/login-form";

// White-label Phase 1: middleware.ts sets x-org-subdomain (pure string
// parsing, no DB — it's deliberately Edge-safe) when the request host is
// <subdomain>.primeaccountax.com. The actual org lookup happens here, in
// the Node runtime, where DB access is normal. No match (no header, or the
// subdomain isn't assigned to any org) → default Prime Accountax branding.
async function resolveBrand(): Promise<{ name: string; logo: string | null }> {
  const sub = headers().get("x-org-subdomain");
  if (!sub) return { name: "Prime Accountax", logo: null };
  try {
    const [org] = await db
      .select({ name: organisations.name, displayName: organisations.displayName, logoUrl: organisations.logoUrl })
      .from(organisations)
      .where(eq(organisations.subdomain, sub))
      .limit(1);
    if (!org) return { name: "Prime Accountax", logo: null };
    return { name: org.displayName || org.name, logo: org.logoUrl ?? null };
  } catch {
    // Branding is cosmetic — never let a lookup failure block the login page.
    return { name: "Prime Accountax", logo: null };
  }
}

// Where to go after signing in. Only a same-site path is honoured (one leading
// slash, never `//host` or `/\host`), so ?next= cannot be used as an open
// redirect. Used by the MCP consent flow to return to /oauth/authorize.
// Only the MCP consent screen needs this, so only that exact path is honoured —
// no control characters or whitespace (a `/%09/host` style value is read by some
// browsers as `//host`), and the path part must stay clean once decoded too.
function safeNext(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const fallback = "/dashboard";
  if (!v || v.length >= 2000 || !v.startsWith("/oauth/authorize?")) return fallback;
  const CLEAN = /^\/(?![/\\])[^\s\u0000-\u001f]*$/;
  if (!CLEAN.test(v)) return fallback;
  try {
    return CLEAN.test(decodeURIComponent(v.split("?")[0])) ? v : fallback;
  } catch {
    return fallback;
  }
}

export default async function LoginPage({ searchParams }: { searchParams: { next?: string | string[] } }) {
  const brand = await resolveBrand();
  return <LoginForm brandName={brand.name} brandLogo={brand.logo} next={safeNext(searchParams?.next)} />;
}
