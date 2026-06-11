import { NextResponse } from "next/server";
import { db } from "@/db";
import { qboTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyOAuthState } from "@/lib/oauth-state";
import { encryptSecret } from "@/lib/crypto";

export async function GET(req: Request) {
  const base = req.headers.get("origin") || process.env.AUTH_URL || "https://ledger-app-alpha-roan.vercel.app";
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const realmId = searchParams.get("realmId");

  // Validate the HMAC-signed state before trusting orgId/userId. A forged or
  // expired state is rejected so a connection can't be bound to another org.
  const verified = verifyOAuthState(searchParams.get("state"));
  if (!verified) {
    return NextResponse.redirect(new URL("/settings?qbo=error&reason=invalid_state", base));
  }
  const { orgId, userId } = verified;

  if (!code || !realmId) {
    return NextResponse.redirect(new URL("/settings?qbo=error&reason=missing_params", base));
  }

  try {
    const clientId = process.env.QBO_CLIENT_ID!;
    const clientSecret = process.env.QBO_CLIENT_SECRET!;
    const redirectUri = process.env.QBO_REDIRECT_URI!;

    const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    });

    if (!tokenRes.ok) {
      console.error("QBO token exchange failed:", await tokenRes.text());
      return NextResponse.redirect(new URL("/settings?qbo=error&reason=token_exchange", base));
    }

    const tokenData = await tokenRes.json();
    const { access_token, refresh_token, expires_in, x_refresh_token_expires_in } = tokenData;

    let companyName = "";
    try {
      const companyRes = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}`,
        { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } }
      );
      if (companyRes.ok) {
        const data = await companyRes.json();
        companyName = data.CompanyInfo?.CompanyName || "";
      }
    } catch (e) {
      console.error("Failed to fetch company info:", e);
    }

    const now = Date.now();
    const accessTokenExpiresAt = new Date(now + (parseInt(expires_in) || 3600) * 1000);
    const refreshTokenExpiresAt = new Date(now + (parseInt(x_refresh_token_expires_in) || 8726400) * 1000);

    const [existing] = await db.select().from(qboTokens).where(eq(qboTokens.orgId, orgId)).limit(1);
    if (existing) {
      // Existing connection: preserve the original userId, just refresh tokens.
      await db.update(qboTokens).set({
        userId, realmId, accessToken: encryptSecret(access_token)!, refreshToken: encryptSecret(refresh_token)!,
        accessTokenExpiresAt, refreshTokenExpiresAt, companyName,
        updatedAt: new Date(),
      }).where(eq(qboTokens.orgId, orgId));
    } else {
      await db.insert(qboTokens).values({
        orgId, userId, realmId,
        accessToken: encryptSecret(access_token)!, refreshToken: encryptSecret(refresh_token)!,
        accessTokenExpiresAt, refreshTokenExpiresAt, companyName,
      });
    }

    return NextResponse.redirect(new URL("/settings?qbo=connected", base));
  } catch (e: any) {
    console.error("QBO callback error:", e);
    return NextResponse.redirect(new URL("/settings?qbo=error&reason=server_error", base));
  }
}
