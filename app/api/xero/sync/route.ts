import { db } from "@/db";
import { xeroTokens, xeroSyncLog } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, desc } from "drizzle-orm";
import { runXeroSync } from "@/lib/xero-sync";

// Allow up to 5 minutes — initial sync on a large Xero org can take several minutes.
export const maxDuration = 300;

/**
 * POST /api/xero/sync — manual full sync triggered from Settings.
 */
export async function POST() {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id;

  try {
    const results = await runXeroSync(orgId!, userId);
    return ok({ success: true, synced: results });
  } catch (e: any) {
    console.error("Xero sync error:", e);
    await db
      .insert(xeroSyncLog)
      .values({ userId, orgId, status: "error", errorMessage: e.message })
      .catch(() => {});
    return bad(`Sync failed: ${e.message}`, 500);
  }
}

/**
 * GET /api/xero/sync — connection status + last sync summary.
 */
export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [token] = await db
    .select()
    .from(xeroTokens)
    .where(eq(xeroTokens.orgId, orgId!))
    .limit(1);

  if (!token) return ok({ connected: false });

  const syncLogs = await db
    .select()
    .from(xeroSyncLog)
    .where(eq(xeroSyncLog.orgId, orgId!))
    .orderBy(desc(xeroSyncLog.syncedAt))
    .limit(1);

  return ok({
    connected: true,
    tenantName: token.tenantName,
    tenantId: token.tenantId,
    lastSync: syncLogs[0] ?? null,
  });
}
