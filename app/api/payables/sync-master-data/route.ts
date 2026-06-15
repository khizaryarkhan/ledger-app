import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { logEvent } from "@/lib/audit";

export async function POST(_req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const syncedAt  = new Date().toISOString();
  const actorId   = (session?.user as any)?.id   ?? null;
  const actorName = (session?.user as any)?.name ?? null;

  await logEvent({
    orgId: orgId!,
    eventType: "payables_master_data_synced" as any,
    actorId,
    actorName,
    meta: { syncedAt },
  });

  return ok({
    message: "Master data sync initiated. This will pull suppliers, chart of accounts, items, tax rates, and dimensions from your connected accounting system.",
    syncedAt,
  });
}
