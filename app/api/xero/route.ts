import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/api";

// Never cache this route — it must always build a fresh authorize URL.
export const dynamic = "force-dynamic";

/**
 * GET /api/xero
 * Redirects the user to Xero's OAuth2 authorization page.
 * After the user grants access, Xero redirects to /api/xero/callback.
 */
export async function GET() {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  // .trim() guards against a stray newline/space pasted into the Vercel env var.
  const clientId = process.env.XERO_CLIENT_ID?.trim();
  const redirectUri = process.env.XERO_REDIRECT_URI?.trim();

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "XERO_CLIENT_ID and XERO_REDIRECT_URI must be set in environment variables" },
      { status: 500 }
    );
  }

  // state = orgId:userId — callback uses this to store the token against the correct org
  const userId = (session!.user as any).id;
  const state = `${orgId}:${userId}`;

  // Scopes per Xero's documented authorize example. openid/profile/email are the
  // standard OpenID Connect scopes Xero expects; offline_access yields a refresh
  // token; accounting.* grant the data access we need.
  const scope =
    "openid profile email offline_access accounting.transactions accounting.contacts";

  // Build the query manually with encodeURIComponent so the spaces between scopes
  // become %20. URLSearchParams encodes spaces as "+", which Xero's identity
  // server does NOT decode back to spaces in the scope field → "invalid_scope".
  const query = [
    `response_type=code`,
    `client_id=${encodeURIComponent(clientId)}`,
    `redirect_uri=${encodeURIComponent(redirectUri)}`,
    `scope=${encodeURIComponent(scope)}`,
    `state=${encodeURIComponent(state)}`,
  ].join("&");

  return NextResponse.redirect(
    `https://login.xero.com/identity/connect/authorize?${query}`,
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
