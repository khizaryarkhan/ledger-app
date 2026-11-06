/**
 * POST /api/resources/timesheets/post
 *   → post every approved, unposted time entry in [periodStart, periodEnd]
 *     as one journal entry. May return { pending: true } if the org's
 *     approval threshold requires a second approver (see
 *     lib/inventory/approvals.ts / app/api/approvals/[id]/approve/route.ts).
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { isAdminRole } from "@/lib/resources/access";
import { requireModule } from "@/lib/modules-server";
import { postTimesheets } from "@/lib/payroll/timesheet-posting";
import { LedgerValidationError } from "@/lib/ledger";

export async function POST(req: Request) {
  const { error, orgId, session, role } = await requireOrg();
  if (error) return error;
  // Posting writes payroll cost to the GL and the preview shows it: org admins only.
  if (!isAdminRole(role)) return bad("Only an admin can post timesheets", 403);
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const body = await req.json().catch(() => ({}));
  const { periodStart, periodEnd, notes } = body ?? {};
  if (!periodStart || !periodEnd) return bad("periodStart and periodEnd are required");

  try {
    const result = await postTimesheets(orgId!, { periodStart, periodEnd, notes }, (session?.user as any)?.id ?? null);
    return ok(result);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[timesheets post]", e);
    return bad("Could not post timesheets for this period", 500);
  }
}
