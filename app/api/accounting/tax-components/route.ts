/**
 * GET  /api/accounting/tax-components  → every component
 * POST /api/accounting/tax-components  → create one, dated from effectiveFrom
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { listTaxSetup, createTaxComponent } from "@/lib/accounting/tax-engine-server";

const ADMIN = ["company_admin", "super_admin"];

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { components } = await listTaxSetup(orgId!);
  return ok(components);
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!ADMIN.includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const r = await createTaxComponent(orgId!, {
    agencyId: String(b?.agencyId ?? ""),
    name: String(b?.name ?? ""),
    rate: Number(b?.rate),
    salesAccountId: b?.salesAccountId ? String(b.salesAccountId) : null,
    purchaseAccountId: b?.purchaseAccountId ? String(b.purchaseAccountId) : null,
    effectiveFrom: String(b?.effectiveFrom ?? ""),
    effectiveTo: b?.effectiveTo ? String(b.effectiveTo) : null,
  });
  if ("error" in r) return bad(r.error);
  return ok(r);
}
