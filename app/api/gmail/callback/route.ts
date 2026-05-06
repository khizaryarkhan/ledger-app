import { NextResponse } from "next/server";
import { db } from "@/db";
import { gmailTokens } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const userId = searchParams.get("state");
  const base = process.env.AUTH_URL || "https://ledger-app-alpha-roan.vercel.app";

  if (!code || !userId) {
    return NextResponse.redirect(new URL("/settings?gmail=error&reason=missing_params", base));
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
      return NextResponse.redirect(new URL("/settings?gmail=error&reason=token_exchange", base));
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

    // Upsert
    const [existing] = await db.select().from(gmailTokens).where(eq(gmailTokens.userId, userId)).limit(1);
    if (existing) {
      await db.update(gmailTokens).set({
        email, accessToken: access_token,
        refreshToken: refresh_token || existing.refreshToken,
        accessTokenExpiresAt, updatedAt: new Date(),
      }).where(eq(gmailTokens.userId, userId));
    } else {
      await db.insert(gmailTokens).values({
        userId, email, accessToken: access_token,
        refreshToken: refresh_token, accessTokenExpiresAt,
      });
    }

    return NextResponse.redirect(new URL("/settings?gmail=connected", base));
  } catch (e: any) {
    console.error("Gmail callback error:", e);
    return NextResponse.redirect(new URL("/settings?gmail=error&reason=server_error", base));
  }
}
