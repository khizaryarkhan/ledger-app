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

  const scope = "offline_access accounting.transactions accounting.contacts";

  // Build the query string manually with encodeURIComponent so that the spaces
  // between scopes become %20. URLSearchParams encodes spaces as "+", which
  // Xero's identity server does NOT decode back to spaces in the scope field —
  // that produces an "invalid_scope" error. %20 is decoded correctly.
  const query = [
    `response_type=code`,
    `client_id=${encodeURIComponent(clientId)}`,
    `redirect_uri=${encodeURIComponent(redirectUri)}`,
    `scope=${encodeURIComponent(scope)}`,
    `state=${encodeURIComponent(state)}`,
  ].join("&");

  return NextResponse.redirect(
    `https://login.xero.com/identity/connect/authorize?${query}`
  );
}
