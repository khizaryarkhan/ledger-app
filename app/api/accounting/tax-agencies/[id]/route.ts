/** DELETE /api/accounting/tax-agencies/[id] → delete an agency (refused if a component still uses it) */

import { requireOrg, ok, bad } from "@/lib/api";
import { deleteTaxAgency } from "@/lib/accounting/tax-engine-server";

const ADMIN = ["company_admin", "super_admin"];

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!ADMIN.includes(role!)) return bad("Admins only", 403);
  const r = await deleteTaxAgency(orgId!, params.id);
  if ("error" in r) return bad(r.error, 409);
  return ok(r);
}
