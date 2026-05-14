import { db } from "@/db";
import { gmailTokens } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";
import { z } from "zod";

const Schema = z.object({
  to: z.string().email(),
  subject: z.string(),
  body: z.string(),
  replyTo: z.string().optional(),
});

// Resolve the ORG's shared Gmail connection. Any user in the org can send
// through it — the OAuth was authorised once by an admin and the token is
// the org's, not an individual user's.
async function getValidGmailToken(orgId: string) {
  const [token] = await db.select().from(gmailTokens).where(eq(gmailTokens.orgId, orgId)).limit(1);
  if (!token) return null;

  const now = Date.now();
  const expiresAt = new Date(token.accessTokenExpiresAt).getTime();

  if (expiresAt - now < 5 * 60 * 1000) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GMAIL_CLIENT_ID!,
        client_secret: process.env.GMAIL_CLIENT_SECRET!,
        refresh_token: token.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) return token;
    const data = await res.json();
    await db.update(gmailTokens).set({
      accessToken: data.access_token,
      accessTokenExpiresAt: new Date(now + (data.expires_in || 3600) * 1000),
      updatedAt: new Date(),
    }).where(eq(gmailTokens.id, token.id));
    return { ...token, accessToken: data.access_token };
  }

  return token;
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const token = await getValidGmailToken(orgId!);
  if (!token) return bad("Gmail not connected for this organisation. An admin can connect it from Settings → Integrations.", 400);

  try {
    const data = Schema.parse(await req.json());

    // Build RFC 2822 email
    const emailLines = [
      `From: ${token.email}`,
      `To: ${data.to}`,
      `Subject: ${data.subject}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      data.body,
    ];
    const raw = Buffer.from(emailLines.join("\r\n"))
      .toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });

    if (!sendRes.ok) {
      const err = await sendRes.json();
      return bad(`Gmail send failed: ${err.error?.message || "Unknown error"}`, 500);
    }

    return ok({ sent: true, from: token.email });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to send email", 500);
  }
}
