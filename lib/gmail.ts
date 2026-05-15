/**
 * Shared Gmail helpers used by both the scheduled cron and the manual trigger.
 */

import { db } from "@/db";
import { gmailTokens } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function getValidGmailToken(orgId: string) {
  const [token] = await db.select().from(gmailTokens).where(eq(gmailTokens.orgId, orgId)).limit(1);
  if (!token) return null;

  const now      = Date.now();
  const expiresAt = new Date(token.accessTokenExpiresAt).getTime();

  if (expiresAt - now < 5 * 60 * 1000) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     process.env.GMAIL_CLIENT_ID!,
        client_secret: process.env.GMAIL_CLIENT_SECRET!,
        refresh_token: token.refreshToken,
        grant_type:    "refresh_token",
      }),
    });
    if (!res.ok) return token;
    const data = await res.json();
    await db.update(gmailTokens).set({
      accessToken:           data.access_token,
      accessTokenExpiresAt:  new Date(now + (data.expires_in || 3600) * 1000),
      updatedAt:             new Date(),
    }).where(eq(gmailTokens.id, token.id));
    return { ...token, accessToken: data.access_token };
  }

  return token;
}

/**
 * Create a Gmail draft (sits in Drafts — user reviews and sends manually).
 * Returns the draft id on success, throws on failure.
 */
export async function createGmailDraft(
  accessToken: string,
  from: string,
  to: string,
  subject: string,
  body: string,
) {
  const raw = Buffer.from(
    [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      body,
    ].join("\r\n"),
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: { raw } }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message ?? "Gmail draft creation failed");
  }

  const data = await res.json();
  return data.id as string;
}
