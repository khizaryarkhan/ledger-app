/**
 * POST   /api/inventory/po-lines/[id]/close   { code, note? }
 * DELETE /api/inventory/po-lines/[id]/close   → reopen
 *
 * Manually closes a Purchase Order line's remaining-to-receive quantity — for
 * when a supplier will never deliver the rest of what was ordered. A fixed
 * reason code is required (a free-text note may add detail): this is a buyer
 * giving up on part of an order, and the reason is what later reports group by.
 *
 * Does not touch orderedBaseQty/receivedQty — po-open treats a closed line's
 * remainingQty as 0, but what was actually ordered and received stays true.
 * Closing is reversible: reopening restores the balance.
 */
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { LedgerValidationError } from "@/lib/ledger";
import { closePoLine, reopenPoLine } from "@/lib/accounting/po-workflow-server";

async function guard() {
  const r = await requireOrg();
  if (r.error) return { res: r.error };
  const { error: modErr } = await requireModule(r.orgId!, "manufacturing");
  if (modErr) return { res: modErr };
  return { orgId: r.orgId!, actor: (r.session?.user as any)?.id ?? null };
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await guard();
  if (g.res) return g.res;
  const b = await req.json().catch(() => ({}));
  try {
    return ok(await closePoLine(g.orgId!, params.id, String(b?.code ?? b?.reason ?? ""), typeof b?.note === "string" ? b.note : null, g.actor));
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[po-lines] close failed:", e);
    return bad("Could not close the line", 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const g = await guard();
  if (g.res) return g.res;
  try {
    return ok(await reopenPoLine(g.orgId!, params.id, g.actor));
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[po-lines] reopen failed:", e);
    return bad("Could not reopen the line", 500);
  }
}
