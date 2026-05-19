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
import { microsoftTokens, users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code       = searchParams.get("code");
  const stateParam = searchParams.get("state") || "";
  // state is "orgId:userId" (new format). Older/legacy: just userId.
  let [orgIdFromState, userId] = stateParam.includes(":")
    ? stateParam.split(":")
    : [null as string | null, stateParam];
  const base = process.env.AUTH_URL || "https://ledger-app-alpha-roan.vercel.app";

  if (!code || !userId) {
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

    // Resolve orgId from state (or fall back to user's primary org)
    let orgId = orgIdFromState;
    if (!orgId) {
      const [u] = await db.select({ orgId: users.orgId }).from(users).where(eq(users.id, userId)).limit(1);
      orgId = u?.orgId ?? null;
    }

    // Upsert by ORG — connection belongs to the organisation, not a single user
    const [existing] = orgId
      ? await db.select().from(microsoftTokens).where(eq(microsoftTokens.orgId, orgId)).limit(1)
      : await db.select().from(microsoftTokens).where(eq(microsoftTokens.userId, userId)).limit(1);

    if (existing) {
      await db.update(microsoftTokens).set({
        orgId:                orgId ?? existing.orgId,
        userId,
        email,
        accessToken:          access_token,
        refreshToken:         refresh_token || existing.refreshToken,
        accessTokenExpiresAt,
        updatedAt:            new Date(),
      }).where(eq(microsoftTokens.id, existing.id));
    } else {
      await db.insert(microsoftTokens).values({
        orgId, userId, email,
        accessToken:          access_token,
        refreshToken:         refresh_token,
        accessTokenExpiresAt,
      });
    }

    return NextResponse.redirect(new URL("/settings/email?microsoft=connected", base));
  } catch (e: any) {
    console.error("Microsoft callback error:", e);
    return NextResponse.redirect(new URL("/settings/email?microsoft=error&reason=server_error", base));
  }
}
