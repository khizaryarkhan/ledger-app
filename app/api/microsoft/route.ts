/**
 * Microsoft OAuth integration — status check and OAuth redirect.
 *
 * GET ?status=1  → { connected: boolean, email?: string }
 * GET            → redirect to Microsoft login
 *
 * Azure app registration required:
 *   Redirect URI: MICROSOFT_REDIRECT_URI
 *   Scopes: Mail.Send, User.Read, offline_access
 *   Account type: Accounts in any organizational directory + personal Microsoft accounts
 *
 * Env vars required:
 *   MICROSOFT_CLIENT_ID
 *   MICROSOFT_REDIRECT_URI
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { microsoftTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg } from "@/lib/api";
import { signOAuthState } from "@/lib/oauth-state";

export async function GET(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const { searchParams } = new URL(req.url);

  // Status check — by ORG, not user. Any user in the org sees the same answer.
  if (searchParams.get("status") === "1") {
    const [token] = await db
      .select()
      .from(microsoftTokens)
      .where(eq(microsoftTokens.orgId, orgId!))
      .limit(1);
    if (!token) return NextResponse.json({ connected: false });
    return NextResponse.json({
      connected:   true,
      email:       token.email,
      connectedBy: token.userId,
    });
  }

  // OAuth redirect
  const clientId    = process.env.MICROSOFT_CLIENT_ID;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "MICROSOFT_CLIENT_ID and MICROSOFT_REDIRECT_URI must be set in Vercel environment variables" },
      { status: 500 },
    );
  }

  const userId = (session!.user as any).id;
  const state  = signOAuthState(orgId!, userId);
  const url =
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&response_mode=query` +
    `&scope=${encodeURIComponent("https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access")}` +
    `&state=${encodeURIComponent(state)}`;

  return NextResponse.redirect(url);
}
