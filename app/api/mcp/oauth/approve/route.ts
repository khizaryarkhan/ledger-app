// The consent decision. Called by the consent screen (components/mcp-consent-form.tsx)
// with the signed-in user's COOKIE session — this is the one route in the MCP
// surface that is cookie-authenticated, so it is CSRF-protected by requiring a
// same-origin Origin header, and it re-validates everything the consent page
// showed (never trusting the browser to have passed it back unchanged).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { mcpClients, organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logEvent } from "@/lib/audit";
import { normaliseScopes, redirectUriMatches, scopesToString } from "@/lib/mcp/oauth";
import { createAuthCode, resolveLiveClaims } from "@/lib/mcp/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host.split(",")[0].trim(); } catch { return false; }
}

function redirectWith(uri: string, params: Record<string, string>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });

  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const clientId = str(b.client_id);
  const redirectUri = str(b.redirect_uri);
  const state = str(b.state).slice(0, 500);

  const [client] = await db.select().from(mcpClients).where(eq(mcpClients.clientId, clientId)).limit(1);
  const registered = Array.isArray(client?.redirectUris) ? (client!.redirectUris as string[]) : [];
  if (!client || !redirectUriMatches(registered, redirectUri)) {
    return NextResponse.json({ error: "Unknown client or redirect address" }, { status: 400 });
  }

  if (b.decision !== "approve") {
    return NextResponse.json({ redirectTo: redirectWith(redirectUri, { error: "access_denied", state }) });
  }

  const codeChallenge = str(b.code_challenge);
  if (!S256_CHALLENGE.test(codeChallenge)) return NextResponse.json({ error: "A PKCE S256 challenge is required" }, { status: 400 });

  const orgId = str(b.orgId);
  const [org] = await db.select({ id: organisations.id, name: organisations.name }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const claims = org ? await resolveLiveClaims(userId, orgId) : null;
  if (!org || !claims) return NextResponse.json({ error: "You do not have access to that organisation" }, { status: 403 });

  const scopes = normaliseScopes(str(b.scope));
  const code = await createAuthCode({ clientId, userId, orgId, scopes, codeChallenge, redirectUri });

  await logEvent({
    orgId, eventType: "integration_connected", actorId: userId, actorName: claims.email,
    meta: { via: "mcp", client: client.clientName, scopes: scopesToString(scopes) },
  });

  return NextResponse.json({ redirectTo: redirectWith(redirectUri, { code, state }) });
}
