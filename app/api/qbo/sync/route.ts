import { db } from "@/db";
import { qboTokens, qboSyncLog } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, desc } from "drizzle-orm";
import { runQboSync } from "@/lib/qbo-sync";

export async function POST() {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id;

  try {
    const results = await runQboSync(orgId!, userId);
    return ok({ success: true, synced: results });
  } catch (e: any) {
    console.error("QBO sync error:", e);
    // Log the error
    await db
      .insert(qboSyncLog)
      .values({ userId, orgId, status: "error", errorMessage: e.message })
      .catch(() => {});
    return bad(`Sync failed: ${e.message}`, 500);
  }
}

export async function GET() {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id;
  const [token] = await db
    .select()
    .from(qboTokens)
    .where(eq(qboTokens.orgId, orgId!))
    .limit(1);
  if (!token) return ok({ connected: false });
  const syncLogs = await db
    .select()
    .from(qboSyncLog)
    .where(eq(qboSyncLog.userId, userId))
    .orderBy(desc(qboSyncLog.syncedAt))
    .limit(1);
  return ok({
    connected: true,
    companyName: token.companyName,
    realmId: token.realmId,
    lastSync: syncLogs[0] ?? null,
  });
}
