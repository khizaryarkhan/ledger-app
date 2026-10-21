/**
 * PATCH  /api/accounting/tax-codes/[id]  → replace a code's name/treatment/
 *                                           compound/component list
 * DELETE /api/accounting/tax-codes/[id]  → delete a code (and its links)
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { updateTaxCode, deleteTaxCode } from "@/lib/accounting/tax-engine-server";

const ADMIN = ["company_admin", "super_admin"];

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!ADMIN.includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const r = await updateTaxCode(orgId!, params.id, {
    name: String(b?.name ?? ""),
    treatment: String(b?.treatment ?? ""),
    compound: !!b?.compound,
    components: Array.isArray(b?.components) ? b.components.map((c: any) => ({ componentId: String(c?.componentId ?? ""), sequence: Number(c?.sequence) || 0 })) : [],
  });
  if ("error" in r) return bad(r.error);
  return ok(r);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!ADMIN.includes(role!)) return bad("Admins only", 403);
  const r = await deleteTaxCode(orgId!, params.id);
  if ("error" in r) return bad(r.error, 409);
  return ok(r);
}
