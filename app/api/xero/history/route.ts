import { db } from "@/db";
import { xeroSyncLog } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { eq, desc } from "drizzle-orm";

/**
 * GET /api/xero/history
 * Returns the last 10 Xero sync log entries for the active org.
 */
export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const logs = await db
    .select()
    .from(xeroSyncLog)
    .where(eq(xeroSyncLog.orgId, orgId!))
    .orderBy(desc(xeroSyncLog.syncedAt))
    .limit(10);

  return ok(logs);
}
