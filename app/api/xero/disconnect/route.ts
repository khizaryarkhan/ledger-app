import { db } from "@/db";
import { xeroTokens } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { eq } from "drizzle-orm";

/**
 * POST /api/xero/disconnect
 * Removes the stored Xero token for the active org.
 * Does NOT revoke the token at Xero — the user can do that from Xero's portal.
 */
export async function POST() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  await db.delete(xeroTokens).where(eq(xeroTokens.orgId, orgId!));
  return ok({ disconnected: true });
}
