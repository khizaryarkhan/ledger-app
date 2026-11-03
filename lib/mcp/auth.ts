// Database half of the MCP server's auth: issue, look up, rotate and revoke
// opaque tokens, and resolve the connecting user's CURRENT identity.
//
// neon-http has no transactions, so every state change that must be exactly-once
// (a code redeemed, a refresh token rotated) is ONE atomic UPDATE … WHERE … RETURNING.

import { db } from "@/db";
import { mcpAuthCodes, mcpTokens, users, userOrganisations, reps } from "@/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  ACCESS_TOKEN_TTL_S, AUTH_CODE_TTL_S, REFRESH_TOKEN_TTL_S, TOKEN_PREFIX, randomToken, sha256Hex,
  normaliseScopes, scopesToString, type McpScope,
} from "./oauth";

export type McpIdentity = { tokenId: string; userId: string; orgId: string; scopes: McpScope[]; clientId: string };

const addSeconds = (s: number) => new Date(Date.now() + s * 1000);

/** Look up a bearer token. Null for unknown, expired or revoked — never throws on bad input. */
export async function resolveMcpToken(bearer: string | null): Promise<McpIdentity | null> {
  if (!bearer || !bearer.startsWith(TOKEN_PREFIX.access) || bearer.length > 200) return null;
  const [row] = await db.select().from(mcpTokens)
    .where(and(eq(mcpTokens.accessHash, sha256Hex(bearer)), isNull(mcpTokens.revokedAt), gt(mcpTokens.accessExpiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  // Best-effort "last used" stamp; losing it must never fail the call.
  db.update(mcpTokens).set({ lastUsedAt: new Date() }).where(eq(mcpTokens.id, row.id)).catch(() => {});
  return { tokenId: row.id, userId: row.userId, orgId: row.orgId, scopes: normaliseScopes(row.scopes), clientId: row.clientId };
}

export type LiveClaims = { sub: string; role: string; orgId: string; repId: string | null; email: string; name: string | null };

/**
 * The user's identity RIGHT NOW. Revoking a membership or deactivating the user
 * takes effect on the next tool call, because nothing here is cached in the token.
 */
export async function resolveLiveClaims(userId: string, orgId: string): Promise<LiveClaims | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.status !== "Active") return null;
  let role: string = user.role;
  if (user.role !== "super_admin") {
    const [m] = await db.select({ role: userOrganisations.role }).from(userOrganisations)
      .where(and(eq(userOrganisations.userId, userId), eq(userOrganisations.orgId, orgId))).limit(1);
    if (!m) return null;
    role = m.role;
  }
  let repId: string | null = null;
  if (user.repId) {
    const [rep] = await db.select({ id: reps.id }).from(reps).where(and(eq(reps.id, user.repId), eq(reps.orgId, orgId))).limit(1);
    if (rep) repId = rep.id;
  }
  return { sub: user.id, role, orgId, repId, email: user.email, name: user.name ?? null };
}

export type IssuedTokens = { accessToken: string; refreshToken: string; expiresIn: number; scope: string };

export async function issueTokens(args: { clientId: string; userId: string; orgId: string; scopes: readonly McpScope[] }): Promise<IssuedTokens> {
  const accessToken = randomToken(TOKEN_PREFIX.access);
  const refreshToken = randomToken(TOKEN_PREFIX.refresh);
  const scope = scopesToString(normaliseScopes(args.scopes));
  await db.insert(mcpTokens).values({
    clientId: args.clientId, userId: args.userId, orgId: args.orgId, scopes: scope,
    accessHash: sha256Hex(accessToken), refreshHash: sha256Hex(refreshToken),
    accessExpiresAt: addSeconds(ACCESS_TOKEN_TTL_S), refreshExpiresAt: addSeconds(REFRESH_TOKEN_TTL_S),
  });
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_S, scope };
}

/**
 * Rotate: the old refresh token dies and a new pair replaces it, in one UPDATE.
 * Two concurrent redemptions of the same refresh token cannot both succeed.
 */
export async function rotateRefreshToken(refreshToken: string, clientId: string): Promise<IssuedTokens | null> {
  if (!refreshToken.startsWith(TOKEN_PREFIX.refresh) || refreshToken.length > 200) return null;
  const accessToken = randomToken(TOKEN_PREFIX.access);
  const next = randomToken(TOKEN_PREFIX.refresh);
  const [row] = await db.update(mcpTokens).set({
    accessHash: sha256Hex(accessToken), refreshHash: sha256Hex(next),
    accessExpiresAt: addSeconds(ACCESS_TOKEN_TTL_S), refreshExpiresAt: addSeconds(REFRESH_TOKEN_TTL_S),
  }).where(and(
    eq(mcpTokens.refreshHash, sha256Hex(refreshToken)), eq(mcpTokens.clientId, clientId),
    isNull(mcpTokens.revokedAt), gt(mcpTokens.refreshExpiresAt, new Date()),
  )).returning();
  if (!row) return null;
  // The user may have lost access since the last refresh — then the chain ends here.
  if (!(await resolveLiveClaims(row.userId, row.orgId))) {
    await db.update(mcpTokens).set({ revokedAt: new Date() }).where(eq(mcpTokens.id, row.id));
    return null;
  }
  return { accessToken, refreshToken: next, expiresIn: ACCESS_TOKEN_TTL_S, scope: row.scopes };
}

export async function createAuthCode(args: {
  clientId: string; userId: string; orgId: string; scopes: readonly McpScope[]; codeChallenge: string; redirectUri: string;
}): Promise<string> {
  const code = randomToken(TOKEN_PREFIX.code);
  await db.insert(mcpAuthCodes).values({
    codeHash: sha256Hex(code), clientId: args.clientId, userId: args.userId, orgId: args.orgId,
    scopes: scopesToString(normaliseScopes(args.scopes)), codeChallenge: args.codeChallenge,
    redirectUri: args.redirectUri, expiresAt: addSeconds(AUTH_CODE_TTL_S),
  });
  return code;
}

/** Single use: marks the code used and returns it in the same statement, or returns null. */
export async function redeemAuthCode(code: string) {
  if (!code.startsWith(TOKEN_PREFIX.code) || code.length > 200) return null;
  const [row] = await db.update(mcpAuthCodes).set({ usedAt: new Date() })
    .where(and(eq(mcpAuthCodes.codeHash, sha256Hex(code)), isNull(mcpAuthCodes.usedAt), gt(mcpAuthCodes.expiresAt, new Date())))
    .returning();
  return row ?? null;
}

/** Revoke by either the access or the refresh token. Always succeeds from the caller's view. */
export async function revokeByToken(token: string): Promise<void> {
  const h = sha256Hex(token);
  const now = new Date();
  await db.update(mcpTokens).set({ revokedAt: now }).where(and(eq(mcpTokens.accessHash, h), isNull(mcpTokens.revokedAt)));
  await db.update(mcpTokens).set({ revokedAt: now }).where(and(eq(mcpTokens.refreshHash, h), isNull(mcpTokens.revokedAt)));
}
