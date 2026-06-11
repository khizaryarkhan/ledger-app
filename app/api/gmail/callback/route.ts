import { NextResponse } from "next/server";
import { db } from "@/db";
import { gmailTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyOAuthState } from "@/lib/oauth-state";
import { encryptSecret } from "@/lib/crypto";
import { logEvent } from "@/lib/audit";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const base = process.env.AUTH_URL || "https://ledger-app-alpha-roan.vercel.app";

  // Validate the HMAC-signed state before trusting orgId/userId.
  const verified = verifyOAuthState(searchParams.get("state"));
  if (!verified) {
    return NextResponse.redirect(new URL("/settings/email?gmail=error&reason=invalid_state", base));
  }
  const { orgId, userId } = verified;

  if (!code) {
    return NextResponse.redirect(new URL("/settings/email?gmail=error&reason=missing_params", base));
  }

  try {
    const clientId = process.env.GMAIL_CLIENT_ID!;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET!;
    const redirectUri = process.env.GMAIL_REDIRECT_URI!;

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      console.error("Gmail token exchange failed:", await tokenRes.text());
      return NextResponse.redirect(new URL("/settings/email?gmail=error&reason=token_exchange", base));
    }

    const tokenData = await tokenRes.json();
    const { access_token, refresh_token, expires_in } = tokenData;

    // Get user email
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const userData = await userRes.json();
    const email = userData.email || "";

    const now = Date.now();
    const accessTokenExpiresAt = new Date(now + (expires_in || 3600) * 1000);

    // orgId comes from the verified state — upsert by ORG so the connection
    // belongs to the organisation, not a single user.
    const [existing] = await db.select().from(gmailTokens).where(eq(gmailTokens.orgId, orgId)).limit(1);
    if (existing) {
      await db.update(gmailTokens).set({
        orgId,
        userId, // record the latest authoriser
        email, accessToken: encryptSecret(access_token)!,
        refreshToken: refresh_token ? encryptSecret(refresh_token)! : existing.refreshToken,
        accessTokenExpiresAt, updatedAt: new Date(),
      }).where(eq(gmailTokens.id, existing.id));
    } else {
      await db.insert(gmailTokens).values({
        orgId, userId, email, accessToken: encryptSecret(access_token)!,
        refreshToken: encryptSecret(refresh_token)!, accessTokenExpiresAt,
      });
    }

    await logEvent({ orgId, eventType: "integration_connected", actorId: userId, meta: { provider: "Gmail", email } });
    return NextResponse.redirect(new URL("/settings/email?gmail=connected", base));
  } catch (e: any) {
    console.error("Gmail callback error:", e);
    return NextResponse.redirect(new URL("/settings/email?gmail=error&reason=server_error", base));
  }
}
