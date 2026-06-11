/**
 * Microsoft OAuth callback — exchanges the authorization code for tokens,
 * fetches the user's email via Graph API, and upserts the org-scoped record.
 *
 * This route must be listed as a public path in middleware.ts so the redirect
 * from Microsoft works without a session.
 *
 * Redirects to /settings/email?microsoft=connected on success,
 * or ?microsoft=error&reason=... on failure.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { microsoftTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyOAuthState } from "@/lib/oauth-state";
import { encryptSecret } from "@/lib/crypto";
import { logEvent } from "@/lib/audit";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code       = searchParams.get("code");
  const base = process.env.AUTH_URL || "https://ledger-app-alpha-roan.vercel.app";

  // Validate the HMAC-signed state before trusting orgId/userId.
  const verified = verifyOAuthState(searchParams.get("state"));
  if (!verified) {
    return NextResponse.redirect(new URL("/settings/email?microsoft=error&reason=invalid_state", base));
  }
  const { orgId, userId } = verified;

  if (!code) {
    return NextResponse.redirect(new URL("/settings/email?microsoft=error&reason=missing_params", base));
  }

  try {
    const clientId     = process.env.MICROSOFT_CLIENT_ID!;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET!;
    const redirectUri  = process.env.MICROSOFT_REDIRECT_URI!;

    // Exchange authorization code for tokens
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    "authorization_code",
        scope:         "https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access",
      }),
    });

    if (!tokenRes.ok) {
      console.error("Microsoft token exchange failed:", await tokenRes.text());
      return NextResponse.redirect(new URL("/settings/email?microsoft=error&reason=token_exchange", base));
    }

    const tokenData = await tokenRes.json();
    const { access_token, refresh_token, expires_in } = tokenData;

    // Fetch email address from Graph API
    const userRes  = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const userData = await userRes.json();
    const email    = userData.mail || userData.userPrincipalName || "";

    const now                 = Date.now();
    const accessTokenExpiresAt = new Date(now + (expires_in || 3600) * 1000);

    // orgId comes from the verified state — upsert by ORG.
    const [existing] = await db.select().from(microsoftTokens).where(eq(microsoftTokens.orgId, orgId)).limit(1);

    if (existing) {
      await db.update(microsoftTokens).set({
        orgId,
        userId,
        email,
        accessToken:          encryptSecret(access_token)!,
        refreshToken:         refresh_token ? encryptSecret(refresh_token)! : existing.refreshToken,
        accessTokenExpiresAt,
        updatedAt:            new Date(),
      }).where(eq(microsoftTokens.id, existing.id));
    } else {
      await db.insert(microsoftTokens).values({
        orgId, userId, email,
        accessToken:          encryptSecret(access_token)!,
        refreshToken:         encryptSecret(refresh_token)!,
        accessTokenExpiresAt,
      });
    }

    await logEvent({ orgId, eventType: "integration_connected", actorId: userId, meta: { provider: "Microsoft", email } });
    return NextResponse.redirect(new URL("/settings/email?microsoft=connected", base));
  } catch (e: any) {
    console.error("Microsoft callback error:", e);
    return NextResponse.redirect(new URL("/settings/email?microsoft=error&reason=server_error", base));
  }
}
