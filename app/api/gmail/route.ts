import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { gmailTokens } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  
  // Status check
  if (searchParams.get("status") === "1") {
    const [token] = await db.select().from(gmailTokens).where(eq(gmailTokens.userId, (session.user as any).id)).limit(1);
    if (!token) return NextResponse.json({ connected: false });
    return NextResponse.json({ connected: true, email: token.email });
  }

  // OAuth redirect
  const clientId = process.env.GMAIL_CLIENT_ID;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "GMAIL_CLIENT_ID and GMAIL_REDIRECT_URI must be set in Vercel environment variables" }, { status: 500 });
  }

  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent("https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email")}&access_type=offline&prompt=consent&state=${encodeURIComponent((session.user as any).id)}`;
  return NextResponse.redirect(url);
}
