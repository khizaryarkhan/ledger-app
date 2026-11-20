/**
 * GET  /api/edi/purchase-orders/[id] → { partner, problems, messages }: can this PO go by EDI, and what was sent
 * POST /api/edi/purchase-orders/[id] → generate its X12 850 and keep it; 422 { problems } names what stops it
 *
 * Delivery is manual in Phase 1: download the file, deliver it, then mark it sent (/api/edi/messages/[id]).
 */
import { ok, requireOrg } from "@/lib/api";
import { checkPurchaseOrder, generatePurchaseOrder850 } from "@/lib/edi/edi-server";
import { ediGuard, ediFail } from "../../_shared";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const g = await ediGuard(await requireOrg(), "read");
  if (g.error) return g.error;
  try { return ok(await checkPurchaseOrder(g.orgId!, params.id)); } catch (e) { return ediFail(e); }
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const g = await ediGuard(await requireOrg(), "operate");
  if (g.error) return g.error;
  try { return ok(await generatePurchaseOrder850(g.orgId!, params.id, g.actorId)); } catch (e) { return ediFail(e); }
}
