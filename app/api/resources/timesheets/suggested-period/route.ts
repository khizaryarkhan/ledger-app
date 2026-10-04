/**
 * GET /api/resources/timesheets/suggested-period
 *   → the default range "Post timesheets" pre-fills, from the org's payroll
 *     frequency + the last posted batch's period-end. A default, never a
 *     lock — the admin can always type a different range.
 */

import { db } from "@/db";
import { organisations, timesheetBatches } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { eq, desc } from "drizzle-orm";
import { suggestNextPeriod } from "@/lib/payroll/pay-periods";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [org] = await db.select({
    payrollFrequency: organisations.payrollFrequency,
    payrollWeekEndDay: organisations.payrollWeekEndDay,
    payrollBiweeklyAnchor: organisations.payrollBiweeklyAnchor,
    payrollSemimonthlyCutoff: organisations.payrollSemimonthlyCutoff,
    payrollMonthCutoff: organisations.payrollMonthCutoff,
  }).from(organisations).where(eq(organisations.id, orgId!)).limit(1);
  if (!org?.payrollFrequency) return bad("Set a payroll frequency in Payroll Settings first.");

  const [lastBatch] = await db.select({ periodEnd: timesheetBatches.periodEnd }).from(timesheetBatches)
    .where(eq(timesheetBatches.orgId, orgId!)).orderBy(desc(timesheetBatches.periodEnd)).limit(1);

  const today = new Date().toISOString().slice(0, 10);
  const period = suggestNextPeriod(org as any, lastBatch?.periodEnd ?? null, today);
  return ok(period);
}
