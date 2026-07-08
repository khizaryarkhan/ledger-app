/**
 * GET /api/ledger/trial-balance?asOf=YYYY-MM-DD
 * Per-account net balances across all journal entries up to the date.
 * `balanced: false` in the response means the posting engine has a bug —
 * it is the permanent integrity check of the ledger.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { trialBalance } from "@/lib/ledger";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const asOf = url.searchParams.get("asOf") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return bad("asOf must be YYYY-MM-DD");

  return ok(await trialBalance(orgId!, asOf));
}
