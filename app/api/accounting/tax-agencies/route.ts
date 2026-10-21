/**
 * GET  /api/accounting/tax-agencies  → every agency (list form shares
 *                                       listTaxSetup with /tax-codes)
 * POST /api/accounting/tax-agencies  → create one
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { listTaxSetup, createTaxAgency } from "@/lib/accounting/tax-engine-server";

const ADMIN = ["company_admin", "super_admin"];

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { agencies } = await listTaxSetup(orgId!);
  return ok(agencies);
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!ADMIN.includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const r = await createTaxAgency(orgId!, {
    name: String(b?.name ?? ""),
    country: b?.country ? String(b.country) : null,
    liabilityAccountId: b?.liabilityAccountId ? String(b.liabilityAccountId) : null,
    filingFrequency: b?.filingFrequency ? String(b.filingFrequency) : null,
  });
  if ("error" in r) return bad(r.error);
  return ok(r);
}
