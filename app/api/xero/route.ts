import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/api";
import { signOAuthState } from "@/lib/oauth-state";

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

  // HMAC-signed state — callback validates it before trusting orgId/userId.
  const userId = (session!.user as any).id;
  const state = signOAuthState(orgId!, userId);

  // This app uses Xero's NEWER GRANULAR accounting scopes. Empirically verified
  // against the authorize endpoint:
  //   accounting.transactions / .read  → REJECTED (invalid_scope) for this app
  //   accounting.invoices               → accepted ✓
  //   accounting.contacts               → accepted ✓
  // We only read data from Xero, but the read-only variants are unverified for
  // this app, so we use the confirmed-working scopes. offline_access yields a
  // refresh token. (CreditNotes/Payments calls degrade gracefully if not granted.)
  const scope =
    "openid accounting.invoices accounting.contacts offline_access";

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

  const authorizeUrl = `https://login.xero.com/identity/connect/authorize?${query}`;

  return NextResponse.redirect(authorizeUrl, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
