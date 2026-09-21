/**
 * GET /api/inventory/transfers/[id] → one transfer with its lines.
 *
 * Read-only. stockTransferDetail scopes every query to the caller's org, so an
 * id from another tenant returns 404 rather than someone else's document.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { stockTransferDetail } from "@/lib/inventory/transfers";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;

  const row = await stockTransferDetail(orgId!, params.id);
  if (!row) return bad("Transfer not found", 404);

  return ok({
    ...row,
    totalCost: Number(row.totalCost ?? 0),
    lines: row.lines.map(l => ({
      ...l,
      qty: Number(l.qty ?? 0),
      unitCost: Number(l.unitCost ?? 0),
      amount: Number(l.amount ?? 0),
    })),
  });
}
