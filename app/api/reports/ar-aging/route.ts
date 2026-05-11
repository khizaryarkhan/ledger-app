/**
 * AR Aging — Summary + Detail in one call.
 *
 * GET /api/reports/ar-aging?asOf=YYYY-MM-DD
 *
 * Returns the full aging result (summary + detail + flags + metadata)
 * computed by lib/ar-aging.ts using Report Date method.
 *
 * The client picks whether to render Summary or Detail from the same payload —
 * no need to refetch when toggling.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { computeArAging } from "@/lib/ar-aging";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const asOf = url.searchParams.get("asOf");
  const includeClosed = url.searchParams.get("includeClosed") === "true";
  if (!asOf) return bad("asOf=YYYY-MM-DD required");

  try {
    const result = await computeArAging(orgId!, asOf, includeClosed);
    return ok(result);
  } catch (e: any) {
    return bad(e?.message || "Failed to compute AR aging", 500);
  }
}
