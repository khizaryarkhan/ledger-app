/**
 * GET    /api/inventory/customer-part-numbers?itemId=   → that item's customer part numbers
 * POST   /api/inventory/customer-part-numbers           { customerId, itemId, itemSkuId?, packLevel?, code }
 *                                                      → set (add or replace) one customer's code at one level
 * DELETE /api/inventory/customer-part-numbers?id=
 *
 * A customer's own code for one of our items (X12 BP on their order), so an
 * inbound order line can be matched to what we sell. Item master data, so like
 * sales SKUs and supplier links it is shared by every org (not module-gated) and
 * only admins change it. Rules: lib/inventory/part-numbers(-server).ts.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import {
  setCustomerPartNumber, deleteCustomerPartNumber, customerPartNumbersForItem, partNumberErrorMessage,
} from "@/lib/inventory/part-numbers-server";

const isAdmin = (role?: string | null) => ["company_admin", "super_admin"].includes(role ?? "");

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const itemId = new URL(req.url).searchParams.get("itemId");
  if (!itemId) return bad("itemId required");
  return ok(await customerPartNumbersForItem(orgId!, itemId));
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!isAdmin(role)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  try {
    return ok(await setCustomerPartNumber(orgId!, {
      customerId: b?.customerId, itemId: b?.itemId, itemSkuId: b?.itemSkuId || null, packLevel: b?.packLevel || "unit", code: b?.code,
    }));
  } catch (e) {
    const m = partNumberErrorMessage(e);
    if (m) return bad(m);
    throw e;
  }
}

export async function DELETE(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!isAdmin(role)) return bad("Admins only", 403);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  if (!(await deleteCustomerPartNumber(orgId!, id))) return bad("Part number not found", 404);
  return ok({ id, deleted: true });
}
