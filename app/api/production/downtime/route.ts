/**
 * GET  /api/production/downtime?moId=&from=&to= → stoppages, newest first
 * POST /api/production/downtime                 → record one (0115)
 */

import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { listDowntime, createDowntime } from "@/lib/inventory/downtime";
import { LedgerValidationError } from "@/lib/ledger";

const day = (v: string | null, end: boolean) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T${end ? "23:59:59" : "00:00:00"}Z`) : null);

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const q = new URL(req.url).searchParams;
  return ok(await listDowntime(orgId!, { moId: q.get("moId"), from: day(q.get("from"), false), to: day(q.get("to"), true) }));
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  const b = await req.json().catch(() => ({}));
  try { return ok(await createDowntime(orgId!, b ?? {}, (session?.user as any)?.id ?? null)); }
  catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message); console.error("[downtime create]", e); return bad("Could not record downtime", 500); }
}
