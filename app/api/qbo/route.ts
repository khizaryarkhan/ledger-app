import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = process.env.QBO_CLIENT_ID;
  const redirectUri = process.env.QBO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "QBO_CLIENT_ID and QBO_REDIRECT_URI must be set in environment variables" }, { status: 500 });
  }

  // Build URL manually to avoid URLSearchParams encoding issues with QBO scope
  // state = orgId:userId so callback knows both
  const state = `${(session!.user as any).orgId}:${(session!.user as any).id}`;
  const url = `https://appcenter.intuit.com/connect/oauth2?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=com.intuit.quickbooks.accounting&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
  return NextResponse.redirect(url);
}
