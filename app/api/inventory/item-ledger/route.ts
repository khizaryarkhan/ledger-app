/**
 * GET /api/inventory/item-ledger?to=YYYY-MM-DD[&from=YYYY-MM-DD][&itemId=<uuid>]
 *
 * The Item Ledger (stock card): per item, opening quantity and value, every movement in the period with its
 * document and lot, and the running balance — plus the books' inventory balance at the end date to tie it to.
 * Read-only. Owned by Manufacturing like the rest of /api/inventory.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { loadItemLedger } from "@/lib/inventory/item-ledger-server";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;

  const q = new URL(req.url).searchParams;
  const to = q.get("to"), from = q.get("from"), itemId = q.get("itemId");
  if (!to || !YMD.test(to)) return bad("to must be YYYY-MM-DD");
  if (from && !YMD.test(from)) return bad("from must be YYYY-MM-DD");
  if (from && from > to) return bad("from must not be after to");
  if (itemId && !UUID.test(itemId)) return bad("itemId is not valid");

  return ok(await loadItemLedger(orgId!, { from: from || null, to, itemId: itemId || null }));
}
