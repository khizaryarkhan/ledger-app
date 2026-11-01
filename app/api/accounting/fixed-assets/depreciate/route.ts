/**
 * POST /api/accounting/fixed-assets/depreciate        body { through: "YYYY-MM" }
 * POST /api/accounting/fixed-assets/depreciate?preview=1   -> what WOULD post, writes nothing
 *
 * Posts one Depreciation entry (Dr expense / Cr accumulated) per unposted
 * asset-month up to and including `through`, dated the month end. Idempotent:
 * a second run posts nothing new. Refused as a whole if any month falls in a
 * closed period - nothing is written until the full plan is valid.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { isPeriod } from "@/lib/accounting/fixed-assets";
import { planDepreciation, postDepreciation } from "@/lib/accounting/fixed-assets-server";
import { LedgerValidationError } from "@/lib/ledger";

const ADMIN = ["company_admin", "super_admin"];

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!ADMIN.includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  if (!isPeriod(b?.through)) return bad("through must be YYYY-MM.");
  const preview = new URL(req.url).searchParams.get("preview") === "1";

  const plan = await planDepreciation(orgId!, b.through);
  const total = Math.round(plan.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  const blocked = plan.filter(p => p.blocked);
  if (preview) return ok({ preview: true, through: b.through, count: plan.length, total, blocked: blocked.length, plan });

  if (blocked.length) {
    return bad(`${blocked.length} month(s) fall in a closed period (${blocked[0].blocked}) - reopen the period first. Nothing was posted.`);
  }
  try {
    const r = await postDepreciation(orgId!, plan, ((session as any)?.user?.id as string) ?? null);
    return ok({ preview: false, through: b.through, count: plan.length, total, ...r });
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[fixed-assets] depreciation run failed", e);
    return bad("Depreciation run stopped part-way; re-run to continue - months already posted are not repeated.", 500);
  }
}
