/**
 * GET  /api/parties/customers/[id]/ship-to[?active=1]  → the customer's delivery addresses
 * POST /api/parties/customers/[id]/ship-to             → add one
 *
 * Customers only. Any org user may maintain a customer's delivery addresses,
 * the same rule as editing the customer itself (collectors add customers).
 * Rules: lib/customer-ship-to(-server).ts.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { listShipTo, createShipTo, shipToErrorOf } from "@/lib/customer-ship-to-server";

export async function GET(req: Request, { params }: { params: { type: string; id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  if (params.type !== "customers") return bad("Delivery addresses are kept for customers only", 404);
  const activeOnly = new URL(req.url).searchParams.get("active") === "1";
  return ok(await listShipTo(orgId!, params.id, { activeOnly }));
}

export async function POST(req: Request, { params }: { params: { type: string; id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  if (params.type !== "customers") return bad("Delivery addresses are kept for customers only", 404);
  const b = await req.json().catch(() => ({}));
  try {
    return ok(await createShipTo(orgId!, params.id, b));
  } catch (e) {
    const s = shipToErrorOf(e);
    if (s) return bad(s.message, s.status);
    throw e;
  }
}
