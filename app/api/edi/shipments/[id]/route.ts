/**
 * GET  /api/edi/shipments/[id] → { partner, problems, messages }: can this shipment be advised by EDI (856), and what was sent
 * POST /api/edi/shipments/[id] → generate its X12 856 (with its SSCC packing) and keep it; 422 { problems } names what stops it
 *
 * Delivery is manual: download the file, deliver it, then mark it sent (/api/edi/messages/[id]).
 */
import { ok, requireOrg } from "@/lib/api";
import { checkShipmentAsn, generateShipmentAsn856 } from "@/lib/edi/outbound-server";
import { ediGuard, ediFail } from "../../_shared";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const g = await ediGuard(await requireOrg(), "read");
  if (g.error) return g.error;
  try { return ok(await checkShipmentAsn(g.orgId!, params.id)); } catch (e) { return ediFail(e); }
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const g = await ediGuard(await requireOrg(), "operate");
  if (g.error) return g.error;
  try { return ok(await generateShipmentAsn856(g.orgId!, params.id, g.actorId)); } catch (e) { return ediFail(e); }
}
