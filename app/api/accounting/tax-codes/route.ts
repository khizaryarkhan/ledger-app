/**
 * GET  /api/accounting/tax-codes  → every tax code (with its components) +
 *                                    every agency/component + the accounts
 *                                    they may map to + whether the org is
 *                                    synced (the admin screen hides itself
 *                                    entirely for a synced org)
 * POST /api/accounting/tax-codes  → create a code with its component list
 *
 * Native tax engine (sales-document refactor, Phase 3c). Reading is open to
 * the org; writing is admin-only, like the chart of accounts and posting
 * groups it sits beside.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { listTaxSetup, createTaxCode } from "@/lib/accounting/tax-engine-server";

const ADMIN = ["company_admin", "super_admin"];

export async function GET() {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const setup = await listTaxSetup(orgId!);
  return ok({ ...setup, canEdit: ADMIN.includes(role!) });
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!ADMIN.includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const r = await createTaxCode(orgId!, {
    name: String(b?.name ?? ""),
    treatment: String(b?.treatment ?? ""),
    compound: !!b?.compound,
    components: Array.isArray(b?.components) ? b.components.map((c: any) => ({ componentId: String(c?.componentId ?? ""), sequence: Number(c?.sequence) || 0 })) : [],
  });
  if ("error" in r) return bad(r.error);
  return ok(r);
}
