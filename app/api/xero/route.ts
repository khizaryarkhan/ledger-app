import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/api";

/**
 * GET /api/xero
 * Redirects the user to Xero's OAuth2 authorization page.
 * After the user grants access, Xero redirects to /api/xero/callback.
 */
export async function GET() {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const clientId = process.env.XERO_CLIENT_ID;
  const redirectUri = process.env.XERO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "XERO_CLIENT_ID and XERO_REDIRECT_URI must be set in environment variables" },
      { status: 500 }
    );
  }

  // state = orgId:userId — callback uses this to store the token against the correct org
  const userId = (session!.user as any).id;
  const state = `${orgId}:${userId}`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "offline_access accounting.transactions accounting.contacts",
    state,
  });

  return NextResponse.redirect(
    `https://login.xero.com/identity/connect/authorize?${params.toString()}`
  );
}
