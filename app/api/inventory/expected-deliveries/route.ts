/**
 * GET  /api/inventory/expected-deliveries?poId=&state=expected|received|cancelled → deliveries with lines and SSCCs
 * POST /api/inventory/expected-deliveries  { poId? | supplierId?, reference?, shipDate?, expectedDate?, carrier?,
 *                                            trackingNo?, notes?, packages?: [{ sscc, packType?, parentSscc? }],
 *                                            lines: [{ poLineId? | itemId?, qtyBase, sscc?, supplierBatchNo?,
 *                                                      productionDate?, bestBeforeDate?, expiryDate? }] }
 *
 * What a supplier says is coming (an ASN, or typed by hand). A claim, never
 * stock: Receiving pre-fills from it. Rules: lib/inventory/expected-delivery.ts.
 */

import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { createExpectedDelivery, listExpectedDeliveries, expectedDeliveryErrorOf } from "@/lib/inventory/expected-delivery-server";
import type { DeliveryState } from "@/lib/inventory/expected-delivery";

const STATES = new Set(["expected", "received", "cancelled"]);

function fail(e: unknown) {
  const x = expectedDeliveryErrorOf(e);
  if (x) return bad(x.message, x.status);
  throw e;
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const q = new URL(req.url).searchParams;
  const state = q.get("state");
  if (state && !STATES.has(state)) return bad("state must be expected, received or cancelled");
  return ok(await listExpectedDeliveries(orgId!, { poId: q.get("poId"), state: (state as DeliveryState) || null }));
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  const b = await req.json().catch(() => ({}));
  try { return ok(await createExpectedDelivery(orgId!, b, (session?.user as any)?.id ?? null)); } catch (e) { return fail(e); }
}
