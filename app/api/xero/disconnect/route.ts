import { db } from "@/db";
import { xeroTokens } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { eq } from "drizzle-orm";
import { decryptSecret } from "@/lib/crypto";
import { logEvent } from "@/lib/audit";

/**
 * POST /api/xero/disconnect
 * Revokes the token at Xero (best-effort), then removes the stored token for
 * the active org so a leaked token can't outlive the disconnect.
 */
export async function POST() {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const [tok] = await db.select().from(xeroTokens).where(eq(xeroTokens.orgId, orgId!)).limit(1);
  const refreshToken = decryptSecret(tok?.refreshToken);
  if (refreshToken && process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET) {
    try {
      const basic = Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString("base64");
      await fetch("https://identity.xero.com/connect/revocation", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
        body: new URLSearchParams({ token: refreshToken }),
      });
    } catch (e: any) {
      console.warn("Xero token revoke failed (continuing with local disconnect):", e?.message);
    }
  }

  await db.delete(xeroTokens).where(eq(xeroTokens.orgId, orgId!));
  await logEvent({ orgId: orgId!, eventType: "integration_disconnected", actorId: (session!.user as any).id, actorName: (session!.user as any).name ?? null, meta: { provider: "Xero" } });
  return ok({ disconnected: true });
}
