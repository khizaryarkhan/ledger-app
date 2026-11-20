/**
 * GET  /api/edi/sales-orders/[id] → { partner, problems, messages }: can this order be acknowledged by EDI (855), and what was sent
 * POST /api/edi/sales-orders/[id] → generate its X12 855 and keep it; 422 { problems } names what stops it
 *
 * Delivery is manual: download the file, deliver it, then mark it sent (/api/edi/messages/[id]).
 */
import { ok, requireOrg } from "@/lib/api";
import { checkSalesOrderAck, generateSalesOrderAck855 } from "@/lib/edi/outbound-server";
import { ediGuard, ediFail } from "../../_shared";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const g = await ediGuard(await requireOrg(), "read");
  if (g.error) return g.error;
  try { return ok(await checkSalesOrderAck(g.orgId!, params.id)); } catch (e) { return ediFail(e); }
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const g = await ediGuard(await requireOrg(), "operate");
  if (g.error) return g.error;
  try { return ok(await generateSalesOrderAck855(g.orgId!, params.id, g.actorId)); } catch (e) { return ediFail(e); }
}
