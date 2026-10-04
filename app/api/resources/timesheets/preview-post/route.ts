/**
 * GET /api/resources/timesheets/preview-post?periodStart=&periodEnd=
 *   → read-only: what posting this period would produce. Shown before the
 *     admin confirms (same pattern as MO completion's preview).
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { previewPost } from "@/lib/payroll/timesheet-posting";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const { searchParams } = new URL(req.url);
  const periodStart = searchParams.get("periodStart");
  const periodEnd = searchParams.get("periodEnd");
  if (!periodStart || !periodEnd) return bad("periodStart and periodEnd are required");

  try {
    return ok(await previewPost(orgId!, { periodStart, periodEnd }));
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[timesheets preview-post]", e);
    return bad("Could not preview this period", 500);
  }
}
