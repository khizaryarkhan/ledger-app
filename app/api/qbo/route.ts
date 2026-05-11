import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/api";

export async function GET() {
  // Use requireOrg so the active_org_id cookie is honoured for multi-org users
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const clientId = process.env.QBO_CLIENT_ID;
  const redirectUri = process.env.QBO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "QBO_CLIENT_ID and QBO_REDIRECT_URI must be set in environment variables" }, { status: 500 });
  }

  // state = orgId:userId — callback uses this to store the token against the correct org
  const userId = (session!.user as any).id;
  const state = `${orgId}:${userId}`;
  const url = `https://appcenter.intuit.com/connect/oauth2?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=com.intuit.quickbooks.accounting&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
  return NextResponse.redirect(url);
}
