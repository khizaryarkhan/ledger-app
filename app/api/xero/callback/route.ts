/**
 * GET /api/xero/callback
 *
 * Xero OAuth2 callback. Exchanges the auth code for tokens, fetches the
 * tenantId from /connections, then stores the token in xero_tokens.
 *
 * This route must be PUBLIC (no auth guard) — the user is redirected here
 * from Xero before our session cookie is present.
 *
 * Add "/api/xero/callback" to the isPublic list in middleware.ts.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { xeroTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyOAuthState } from "@/lib/oauth-state";
import { encryptSecret } from "@/lib/crypto";

export async function GET(req: Request) {
  const base =
    process.env.AUTH_URL ||
    req.headers.get("origin") ||
    "https://primeaccountax.com";

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  // Validate the HMAC-signed state before trusting orgId/userId.
  const verified = verifyOAuthState(searchParams.get("state"));
  if (!verified) {
    return NextResponse.redirect(
      new URL("/settings?xero=error&reason=invalid_state", base)
    );
  }
  const { orgId, userId } = verified;

  if (!code) {
    return NextResponse.redirect(
      new URL("/settings?xero=error&reason=missing_params", base)
    );
  }

  try {
    const clientId = process.env.XERO_CLIENT_ID!;
    const clientSecret = process.env.XERO_CLIENT_SECRET!;
    const redirectUri = process.env.XERO_REDIRECT_URI!;

    // Step 1: Exchange code for tokens
    const tokenRes = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      console.error("Xero token exchange failed:", await tokenRes.text());
      return NextResponse.redirect(
        new URL("/settings?xero=error&reason=token_exchange", base)
      );
    }

    const tokenData = await tokenRes.json();
    const { access_token, refresh_token, expires_in } = tokenData;
    const now = Date.now();
    const accessTokenExpiresAt = new Date(now + (parseInt(expires_in) || 1800) * 1000);
    const refreshTokenExpiresAt = new Date(now + 60 * 24 * 60 * 60 * 1000); // 60-day rolling window

    // Step 2: Get tenantId from /connections
    const connectionsRes = await fetch("https://api.xero.com/connections", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!connectionsRes.ok) {
      console.error("Xero /connections failed:", await connectionsRes.text());
      return NextResponse.redirect(
        new URL("/settings?xero=error&reason=connections_fetch", base)
      );
    }

    const connections: any[] = await connectionsRes.json();
    // Pick the first ACCOUNTING tenant (ignore FILES / PAYROLL tenants)
    const tenant =
      connections.find((c) => c.tenantType === "ORGANISATION") || connections[0];

    if (!tenant?.tenantId) {
      return NextResponse.redirect(
        new URL("/settings?xero=error&reason=no_tenant", base)
      );
    }

    const tenantId: string = tenant.tenantId;
    const tenantName: string = tenant.tenantName || "";

    // Step 3: Upsert token row
    const [existing] = await db
      .select()
      .from(xeroTokens)
      .where(eq(xeroTokens.orgId, orgId))
      .limit(1);

    if (existing) {
      await db
        .update(xeroTokens)
        .set({
          userId,
          tenantId,
          tenantName,
          accessToken: encryptSecret(access_token)!,
          refreshToken: encryptSecret(refresh_token)!,
          accessTokenExpiresAt,
          refreshTokenExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(xeroTokens.orgId, orgId));
    } else {
      await db.insert(xeroTokens).values({
        orgId,
        userId,
        tenantId,
        tenantName,
        accessToken: encryptSecret(access_token)!,
        refreshToken: encryptSecret(refresh_token)!,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
      });
    }

    return NextResponse.redirect(new URL("/settings?xero=connected", base));
  } catch (e: any) {
    console.error("Xero callback error:", e);
    return NextResponse.redirect(
      new URL("/settings?xero=error&reason=server_error", base)
    );
  }
}
