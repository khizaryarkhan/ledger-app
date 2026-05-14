import { db } from "@/db";
import { qboTokens, qboSyncLog } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, desc } from "drizzle-orm";
import { runQboSync } from "@/lib/qbo-sync";

// Allow the sync to run up to 5 minutes (Vercel Pro plan max).
// Initial backfill of payments + applications on a large org takes longer
// than the default 10-60s limit.
export const maxDuration = 300;

export async function POST() {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id;

  try {
    const results = await runQboSync(orgId!, userId);
    return ok({ success: true, synced: results });
  } catch (e: any) {
    console.error("QBO sync error:", e);
    // Log the error against the ORG (with userId for audit) so every user in
    // the org sees the same sync history.
    await db
      .insert(qboSyncLog)
      .values({ userId, orgId, status: "error", errorMessage: e.message })
      .catch(() => {});
    return bad(`Sync failed: ${e.message}`, 500);
  }
}

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [token] = await db
    .select()
    .from(qboTokens)
    .where(eq(qboTokens.orgId, orgId!))
    .limit(1);
  if (!token) return ok({ connected: false });
  // Latest sync for the ORGANISATION, not the current user. Any user in the
  // org should see the same "last sync" / "connection state" view.
  const syncLogs = await db
    .select()
    .from(qboSyncLog)
    .where(eq(qboSyncLog.orgId, orgId!))
    .orderBy(desc(qboSyncLog.syncedAt))
    .limit(1);
  return ok({
    connected: true,
    companyName: token.companyName,
    realmId: token.realmId,
    lastSync: syncLogs[0] ?? null,
  });
}
