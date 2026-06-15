/**
 * POST /api/payables/sync
 * Manual AP sync trigger — pulls suppliers, COA, items, tax rates, dimensions,
 * and bills from connected QBO or Xero account into AP tables.
 */
import { requireOrg, ok, bad } from "@/lib/api";
import { db } from "@/db";
import { qboTokens, xeroTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runQboApSync } from "@/lib/qbo-ap-sync";
import { runXeroApSync } from "@/lib/xero-ap-sync";
import { logEvent } from "@/lib/audit";

export const maxDuration = 300;

export async function POST() {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const userId = (session!.user as any).id;

  // Determine which accounting system is connected
  const [qboToken] = await db
    .select({ id: qboTokens.id })
    .from(qboTokens)
    .where(eq(qboTokens.orgId, orgId!))
    .limit(1);

  const [xeroToken] = await db
    .select({ id: xeroTokens.id })
    .from(xeroTokens)
    .where(eq(xeroTokens.orgId, orgId!))
    .limit(1);

  if (!qboToken && !xeroToken) {
    return bad("No accounting system connected. Connect QuickBooks or Xero under Settings → Integrations.", 400);
  }

  const results: Record<string, any> = {};
  const errors: string[] = [];

  if (qboToken) {
    try {
      results.qbo = await runQboApSync(orgId!, userId);
    } catch (e: any) {
      errors.push(`QBO: ${e.message}`);
    }
  }

  if (xeroToken) {
    try {
      results.xero = await runXeroApSync(orgId!, userId);
    } catch (e: any) {
      errors.push(`Xero: ${e.message}`);
    }
  }

  await logEvent({
    orgId: orgId!,
    eventType: "payables_master_data_synced",
    actorId: userId,
    actorName: (session!.user as any).name ?? null,
    meta: { results, errors },
  });

  if (errors.length > 0 && !results.qbo && !results.xero) {
    return bad(`Sync failed: ${errors.join("; ")}`, 500);
  }

  return ok({ success: true, results, errors });
}
