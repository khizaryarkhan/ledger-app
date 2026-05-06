import { NextResponse } from "next/server";
import { db } from "@/db";
import { qboTokens } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const realmId = searchParams.get("realmId");
  const stateParam = searchParams.get("state") || "";
  // state = "orgId:userId"
  const [orgId, userId] = stateParam.includes(":") ? stateParam.split(":") : [stateParam, stateParam];

  if (!code || !realmId || !userId) {
    const base = req.headers.get("origin") || process.env.AUTH_URL || "https://ledger-app-alpha-roan.vercel.app";
    return NextResponse.redirect(new URL("/settings?qbo=error&reason=missing_params", base));
  }

  try {
    const clientId = process.env.QBO_CLIENT_ID!;
    const clientSecret = process.env.QBO_CLIENT_SECRET!;
    const redirectUri = process.env.QBO_REDIRECT_URI!;

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("QBO token exchange failed:", err);
      return NextResponse.redirect(new URL("/settings?qbo=error&reason=token_exchange", base));
    }

    const tokenData = await tokenRes.json();
    const { access_token, refresh_token, expires_in, x_refresh_token_expires_in } = tokenData;

    // Get company name
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
    console.log("Token expires at:", accessTokenExpiresAt, "Refresh expires at:", refreshTokenExpiresAt);

    // Upsert token — one token record per user

    // Upsert by orgId — one QBO connection per org
    const [existing] = await db.select().from(qboTokens).where(eq(qboTokens.orgId, orgId)).limit(1);
    if (existing) {
      await db.update(qboTokens).set({
        realmId, accessToken: access_token, refreshToken: refresh_token,
        accessTokenExpiresAt, refreshTokenExpiresAt, companyName,
        connectedByUserId: userId, updatedAt: new Date(),
      }).where(eq(qboTokens.orgId, orgId));
    } else {
      await db.insert(qboTokens).values({
        orgId, connectedByUserId: userId, realmId,
        accessToken: access_token, refreshToken: refresh_token,
        accessTokenExpiresAt, refreshTokenExpiresAt, companyName,
      });
    }

    return NextResponse.redirect(new URL("/settings?qbo=connected", base));
  } catch (e: any) {
    console.error("QBO callback error:", e);
    return NextResponse.redirect(new URL("/settings?qbo=error&reason=server_error", base));
  }
}
