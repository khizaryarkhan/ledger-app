// The consent screen an MCP client sends the user to. Public in middleware (the
// page authenticates itself) so it can bounce an anonymous visitor to /login and
// bring them back here — with every OAuth parameter intact — afterwards.
//
// Anything wrong with the request itself (unknown client, redirect address that
// was not registered) is shown HERE and never redirected: sending a user, or an
// error, to an unvalidated address is exactly what open-redirect attacks use.

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { mcpClients, organisations, userOrganisations, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { McpConsentForm } from "@/components/mcp-consent-form";
import { redirectUriMatches } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-950 p-4">
      <div className="w-full max-w-md rounded-lg border border-stone-800 bg-stone-900 p-6 text-stone-300 text-sm">{children}</div>
    </div>
  );
}

export default async function AuthorizePage({ searchParams }: { searchParams: Params }) {
  const clientId = one(searchParams.client_id);
  const redirectUri = one(searchParams.redirect_uri);
  const codeChallenge = one(searchParams.code_challenge);
  const state = one(searchParams.state);

  if (one(searchParams.response_type) !== "code" || one(searchParams.code_challenge_method) !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    return <Problem>This connection request is malformed (it must use the authorization-code flow with PKCE S256). Nothing was connected.</Problem>;
  }

  const [client] = clientId ? await db.select().from(mcpClients).where(eq(mcpClients.clientId, clientId)).limit(1) : [];
  const registered = Array.isArray(client?.redirectUris) ? (client!.redirectUris as string[]) : [];
  if (!client || !redirectUriMatches(registered, redirectUri)) {
    return <Problem>This application is not registered, or its return address does not match. Nothing was connected.</Problem>;
  }

  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) {
    const qs = new URLSearchParams();
    for (const k of ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "scope", "state", "resource"]) {
      const v = one(searchParams[k]);
      if (v) qs.set(k, v);
    }
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs.toString()}`)}`);
  }

  const memberships = await db.select({ id: organisations.id, name: organisations.name, displayName: organisations.displayName, role: userOrganisations.role })
    .from(userOrganisations).innerJoin(organisations, eq(organisations.id, userOrganisations.orgId))
    .where(eq(userOrganisations.userId, userId!));
  const orgs = memberships.map((m) => ({ id: m.id, name: m.displayName || m.name, role: m.role }));

  if (orgs.length === 0) {
    const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId!)).limit(1);
    return <Problem>{u?.role === "super_admin" ? "Platform administrators connect to a specific organisation from within that organisation." : "Your account is not a member of any organisation."}</Problem>;
  }

  // The requested scope is deliberately NOT used to pre-tick anything: it comes
  // from a URL anyone can craft, so a one-click "Allow" on a link from an attacker
  // must never grant more than read. The user chooses write/delete/sensitive here.
  let host = redirectUri;
  try { host = new URL(redirectUri).host || new URL(redirectUri).protocol; } catch { /* keep raw */ }

  return (
    <McpConsentForm
      clientName={client.clientName}
      redirectHost={host}
      orgs={orgs}
      params={{ client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, state }}
    />
  );
}
