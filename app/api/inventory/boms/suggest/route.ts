/**
 * GET /api/inventory/boms/suggest?itemId= → the product's most recent Active BOM
 * as a prefill for a NEW one (new id, suggested code like BOM_X-V2), or nulls
 * when the product has none. Nothing is created.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { suggestFor } from "@/lib/inventory/bom-save";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const itemId = new URL(req.url).searchParams.get("itemId");
  if (!itemId) return bad("itemId required");
  return ok(await suggestFor(orgId!, itemId));
}
