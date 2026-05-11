import { db } from "@/db";
import { qboSyncLog } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id;
  const logs = await db.select().from(qboSyncLog)
    .where(eq(qboSyncLog.orgId, orgId!))
    .orderBy(desc(qboSyncLog.syncedAt))
    .limit(10);
  return ok(logs);
}
