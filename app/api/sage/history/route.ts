/**
 * GET /api/sage/history
 *
 * Returns the 20 most recent Sage Intacct sync log entries for this org.
 */

import { db } from "@/db";
import { sageSyncLog } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireOrg, ok } from "@/lib/api";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const history = await db
    .select()
    .from(sageSyncLog)
    .where(eq(sageSyncLog.orgId, orgId!))
    .orderBy(desc(sageSyncLog.syncedAt))
    .limit(20);

  return ok(history);
}
