/**
 * GET /api/inventory/shipping/[id]/labels → everything the printable pallet / carton labels of one shipment need:
 * who ships, who receives, and per package its SSCC (for the GS1-128 barcode), its type and what is inside.
 * Read-only: nothing is posted and no SSCC is taken (packing already allocated them).
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { shipmentLabels } from "@/lib/inventory/sscc-labels-server";
import { ssccErrorOf } from "@/lib/inventory/sscc-server";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  try { return ok(await shipmentLabels(orgId!, params.id)); }
  catch (e) { const s = ssccErrorOf(e); if (s) return bad(s.message, s.status); throw e; }
}
