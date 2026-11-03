// OAuth token endpoint: authorization_code (with PKCE S256) and refresh_token.
// Codes are single-use and short-lived; refresh tokens rotate on every use.

import { NextRequest } from "next/server";
import { db } from "@/db";
import { mcpClients } from "@/db/schema";
import { eq } from "drizzle-orm";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { normaliseScopes, verifyPkceS256 } from "@/lib/mcp/oauth";
import { issueTokens, redeemAuthCode, resolveLiveClaims, rotateRefreshToken } from "@/lib/mcp/auth";
import { NO_STORE, json, oauthError, preflight, readParams } from "@/lib/mcp/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(req: NextRequest) {
  const rl = await rateLimit(`mcp-token:${clientIp(req)}`, 120, 60);
  if (!rl.ok) return oauthError("temporarily_unavailable", "Too many requests. Slow down.", 429);

  const p = await readParams(req);
  if (!p) return oauthError("invalid_request", "Send application/x-www-form-urlencoded parameters.");

  const clientId = str(p.client_id);
  if (!clientId) return oauthError("invalid_client", "client_id is required.", 401);
  const [client] = await db.select({ id: mcpClients.id }).from(mcpClients).where(eq(mcpClients.clientId, clientId)).limit(1);
  if (!client) return oauthError("invalid_client", "Unknown client_id.", 401);

  const grant = str(p.grant_type);

  if (grant === "authorization_code") {
    const row = await redeemAuthCode(str(p.code));
    // Whatever is wrong, the answer is the same — never say which part failed.
    const fail = () => oauthError("invalid_grant", "The authorization code is invalid, expired or already used.");
    if (!row) return fail();
    if (row.clientId !== clientId || row.redirectUri !== str(p.redirect_uri)) return fail();
    if (!verifyPkceS256(str(p.code_verifier), row.codeChallenge)) return fail();
    if (!(await resolveLiveClaims(row.userId, row.orgId))) return fail();

    const t = await issueTokens({ clientId, userId: row.userId, orgId: row.orgId, scopes: normaliseScopes(row.scopes) });
    return json({ access_token: t.accessToken, token_type: "Bearer", expires_in: t.expiresIn, refresh_token: t.refreshToken, scope: t.scope }, 200, NO_STORE);
  }

  if (grant === "refresh_token") {
    const t = await rotateRefreshToken(str(p.refresh_token), clientId);
    if (!t) return oauthError("invalid_grant", "The refresh token is invalid, expired or revoked.");
    return json({ access_token: t.accessToken, token_type: "Bearer", expires_in: t.expiresIn, refresh_token: t.refreshToken, scope: t.scope }, 200, NO_STORE);
  }

  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

export const OPTIONS = preflight;
