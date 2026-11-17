/**
 * GET /api/inventory/lot-suggestion
 *
 * Peeks (doesn't consume) the next Stock-Item/Raw-Material lot code, for
 * pre-filling the lot-number field on Goods Receipt / Bill lines. The user
 * can accept it or overwrite it with a supplier's own batch number — either
 * way lib/inventory/valuation.ts's resolveLotNo (via resolveDocNumber)
 * records what was actually used and advances the series past it.
 * Finished Product / Work in Progress lots are never suggested here — they're
 * always system-generated at commit time, not editable.
 */

import { requireOrg, ok } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { peekDocNumberSkipping } from "@/lib/accounting/numbering";

/** `?skip=A,B` = lot numbers already used by other rows of the same unposted visit; the suggestion steps past them. */
export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const skip = (new URL(req.url).searchParams.get("skip") ?? "").split(",").map(s => s.trim().slice(0, 64)).filter(Boolean).slice(0, 200);
  const code = await peekDocNumberSkipping(orgId!, "LotSIRM", skip);
  return ok({ code });
}
