import { NextResponse } from "next/server";
import { db } from "@/db";
import { gmailTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg } from "@/lib/api";

export async function GET(req: Request) {
  // requireOrg validates membership against the active org and gives us the
  // orgId every user in the org should see, regardless of who authorised
  // the Gmail connection.
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const { searchParams } = new URL(req.url);

  // Status check — by ORG, not user. Any user in the org sees the same answer.
  if (searchParams.get("status") === "1") {
    const [token] = await db.select()
      .from(gmailTokens)
      .where(eq(gmailTokens.orgId, orgId!))
      .limit(1);
    if (!token) return NextResponse.json({ connected: false });
    return NextResponse.json({
      connected:    true,
      email:        token.email,
      connectedBy:  token.userId, // for audit only
    });
  }

  // OAuth redirect — passes orgId and userId so the callback can store both.
  const clientId    = process.env.GMAIL_CLIENT_ID;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "GMAIL_CLIENT_ID and GMAIL_REDIRECT_URI must be set in Vercel environment variables" }, { status: 500 });
  }
  const userId = (session!.user as any).id;
  const state  = `${orgId}:${userId}`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent("https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email")}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
  return NextResponse.redirect(url);
}
