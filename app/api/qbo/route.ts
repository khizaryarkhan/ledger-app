import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/api";
import { signOAuthState } from "@/lib/oauth-state";

export async function GET() {
  // Use requireOrg so the active_org_id cookie is honoured for multi-org users
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const clientId = process.env.QBO_CLIENT_ID;
  const redirectUri = process.env.QBO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "QBO_CLIENT_ID and QBO_REDIRECT_URI must be set in environment variables" }, { status: 500 });
  }

  // HMAC-signed state — callback validates it before trusting orgId/userId,
  // so a forged state can't bind this connection to another org.
  const userId = (session!.user as any).id;
  const state = signOAuthState(orgId!, userId);
  // The Payments API (charges, refunds, cards — used by the AI connection's qbo_api
  // tool) needs its own scope. It is asked for only when QBO_PAYMENTS_SCOPE=1,
  // because requesting a scope the Intuit app is not set up for fails the whole
  // connect — switching it on must follow enabling Payments on the Intuit app.
  const scope = process.env.QBO_PAYMENTS_SCOPE === "1"
    ? "com.intuit.quickbooks.accounting com.intuit.quickbooks.payment"
    : "com.intuit.quickbooks.accounting";
  const url = `https://appcenter.intuit.com/connect/oauth2?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
  return NextResponse.redirect(url);
}
