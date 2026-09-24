/**
 * GET /api/accounting/stock-vs-gl[?asAt=YYYY-MM-DD]
 *
 * R-09: stock value vs GL balance for every account that plays an inventory
 * role, and open job-work value vs the Work-in-Progress account. Read-only.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { stockVsGl } from "@/lib/accounting/account-roles-server";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const asAt = new URL(req.url).searchParams.get("asAt");
  if (asAt && !/^\d{4}-\d{2}-\d{2}$/.test(asAt)) return bad("asAt must be YYYY-MM-DD");
  return ok({ asAt: asAt ?? null, ...(await stockVsGl(orgId!, asAt, { provision: false })) });
}
