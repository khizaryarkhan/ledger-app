/**
 * GET   /api/resources/payroll-settings   → the org's payroll posting cadence
 * PATCH /api/resources/payroll-settings   → set it (admin only)
 *
 * Each frequency carries only the one anchor it actually needs (see
 * lib/payroll/pay-periods.ts) — the others are cleared to null so a stale
 * anchor from a previously-selected frequency can never leak into a new one.
 */

import { db } from "@/db";
import { organisations } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";

const FREQUENCIES = ["weekly", "biweekly", "semi_monthly", "monthly"] as const;

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [row] = await db.select({
    payrollFrequency: organisations.payrollFrequency,
    payrollWeekEndDay: organisations.payrollWeekEndDay,
    payrollBiweeklyAnchor: organisations.payrollBiweeklyAnchor,
    payrollSemimonthlyCutoff: organisations.payrollSemimonthlyCutoff,
    payrollMonthCutoff: organisations.payrollMonthCutoff,
  }).from(organisations).where(eq(organisations.id, orgId!)).limit(1);

  return ok(row);
}

export async function PATCH(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  const body = await req.json().catch(() => ({}));
  const { payrollFrequency, payrollWeekEndDay, payrollBiweeklyAnchor, payrollSemimonthlyCutoff, payrollMonthCutoff } = body ?? {};
  if (payrollFrequency !== null && !FREQUENCIES.includes(payrollFrequency)) return bad("payrollFrequency must be weekly, biweekly, semi_monthly or monthly");

  const updates: Record<string, any> = {
    updatedAt: new Date(),
    payrollFrequency: payrollFrequency ?? null,
    payrollWeekEndDay: null, payrollBiweeklyAnchor: null, payrollSemimonthlyCutoff: null, payrollMonthCutoff: null,
  };

  if (payrollFrequency === "weekly" || payrollFrequency === "biweekly") {
    const d = Number(payrollWeekEndDay);
    if (!Number.isInteger(d) || d < 1 || d > 7) return bad("payrollWeekEndDay must be 1-7 (Mon-Sun)");
    updates.payrollWeekEndDay = d;
  }
  if (payrollFrequency === "biweekly") {
    if (!payrollBiweeklyAnchor || !/^\d{4}-\d{2}-\d{2}$/.test(payrollBiweeklyAnchor)) return bad("payrollBiweeklyAnchor must be a date (YYYY-MM-DD) — one known period-end");
    updates.payrollBiweeklyAnchor = payrollBiweeklyAnchor;
  }
  if (payrollFrequency === "semi_monthly") {
    const c = payrollSemimonthlyCutoff != null ? Number(payrollSemimonthlyCutoff) : 15;
    if (!Number.isInteger(c) || c < 1 || c > 27) return bad("payrollSemimonthlyCutoff must be 1-27");
    updates.payrollSemimonthlyCutoff = c;
  }
  if (payrollFrequency === "monthly" && payrollMonthCutoff != null) {
    const c = Number(payrollMonthCutoff);
    if (!Number.isInteger(c) || c < 1 || c > 31) return bad("payrollMonthCutoff must be 1-31");
    updates.payrollMonthCutoff = c;
  }

  await db.update(organisations).set(updates).where(eq(organisations.id, orgId!));

  const [row] = await db.select({
    payrollFrequency: organisations.payrollFrequency,
    payrollWeekEndDay: organisations.payrollWeekEndDay,
    payrollBiweeklyAnchor: organisations.payrollBiweeklyAnchor,
    payrollSemimonthlyCutoff: organisations.payrollSemimonthlyCutoff,
    payrollMonthCutoff: organisations.payrollMonthCutoff,
  }).from(organisations).where(eq(organisations.id, orgId!)).limit(1);
  return ok(row);
}
