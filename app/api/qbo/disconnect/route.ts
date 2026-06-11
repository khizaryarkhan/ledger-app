import { db } from "@/db";
import { qboTokens } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { eq } from "drizzle-orm";
import { decryptSecret } from "@/lib/crypto";

export async function POST() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  // Revoke at Intuit BEFORE deleting locally, so a leaked token can't outlive
  // the disconnect. Best-effort — never block the local cleanup on a failure.
  const [tok] = await db.select().from(qboTokens).where(eq(qboTokens.orgId, orgId!)).limit(1);
  const refreshToken = decryptSecret(tok?.refreshToken);
  if (refreshToken && process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET) {
    try {
      const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
      await fetch("https://developer.api.intuit.com/v2/oauth2/tokens/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${basic}`, Accept: "application/json" },
        body: JSON.stringify({ token: refreshToken }),
      });
    } catch (e: any) {
      console.warn("QBO token revoke failed (continuing with local disconnect):", e?.message);
    }
  }

  await db.delete(qboTokens).where(eq(qboTokens.orgId, orgId!));
  return ok({ disconnected: true });
}
