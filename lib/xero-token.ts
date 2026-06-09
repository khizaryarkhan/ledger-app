/**
 * Xero token helper — used by xero-sync.ts and any server-side code
 * that needs a valid Xero access token for an org.
 *
 * Xero access tokens expire every 30 minutes.
 * Refresh tokens expire after 60 days (rolling window on each refresh).
 */

import { db } from "@/db";
import { xeroTokens } from "@/db/schema";
import { eq } from "drizzle-orm";

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";

export interface OrgXeroToken {
  accessToken: string;
  tenantId: string;
  orgId: string;
  userId: string;
}

/**
 * Return a valid (auto-refreshed) Xero access token for the given org.
 * Returns null if the org has no Xero connection.
 * Throws if the refresh token is expired (org must reconnect).
 */
export async function getOrgXeroToken(orgId: string): Promise<OrgXeroToken | null> {
  const [token] = await db
    .select()
    .from(xeroTokens)
    .where(eq(xeroTokens.orgId, orgId))
    .limit(1);

  if (!token) return null;

  const now = Date.now();

  // Refresh if less than 5 minutes remaining on the access token
  if (new Date(token.accessTokenExpiresAt).getTime() - now < 5 * 60 * 1000) {
    const clientId = process.env.XERO_CLIENT_ID;
    const clientSecret = process.env.XERO_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error("XERO_CLIENT_ID and XERO_CLIENT_SECRET must be set");
    }

    const res = await fetch(XERO_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Xero refresh token rejected (HTTP ${res.status}). Reconnect Xero under Settings → Integrations. Detail: ${body.slice(0, 200)}`
      );
    }

    const d = await res.json();
    await db
      .update(xeroTokens)
      .set({
        accessToken: d.access_token,
        refreshToken: d.refresh_token || token.refreshToken,
        accessTokenExpiresAt: new Date(now + (d.expires_in || 1800) * 1000),
        // Xero rolling 60-day refresh token window
        refreshTokenExpiresAt: new Date(now + 60 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(xeroTokens.orgId, orgId));

    return {
      accessToken: d.access_token,
      tenantId: token.tenantId,
      orgId: token.orgId!,
      userId: token.userId,
    };
  }

  return {
    accessToken: token.accessToken,
    tenantId: token.tenantId,
    orgId: token.orgId!,
    userId: token.userId,
  };
}
