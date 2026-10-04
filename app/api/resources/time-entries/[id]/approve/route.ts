/**
 * POST /api/resources/time-entries/:id/approve — Submitted -> Approved
 *
 * If the entry's type is a balance-tracked leave type (leave_policies
 * exists), this also records the usage in the leave balance ledger — a
 * leave balance is a derived SUM, never a mutable field, so this is the one
 * place a "usage" row is written (lib/payroll/leave-balance.ts).
 */

import { db } from "@/db";
import { timeEntries, timesheetTypes, leavePolicies, leaveBalanceEntries } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq } from "drizzle-orm";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [existing] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, params.id), eq(timeEntries.orgId, orgId!))).limit(1);
  if (!existing) return bad("Time entry not found", 404);
  if (existing.status !== "submitted") return bad("Only a Submitted entry can be approved", 409);

  const approverId = (session?.user as any)?.id ?? null;
  const [row] = await db.update(timeEntries).set({ status: "approved", approvedBy: approverId, approvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(timeEntries.id, params.id), eq(timeEntries.orgId, orgId!))).returning();

  const [type] = await db.select({ id: timesheetTypes.id, category: timesheetTypes.category }).from(timesheetTypes)
    .where(and(eq(timesheetTypes.id, existing.timesheetTypeId), eq(timesheetTypes.orgId, orgId!))).limit(1);
  if (type?.category === "leave") {
    const [policy] = await db.select({ id: leavePolicies.id }).from(leavePolicies)
      .where(and(eq(leavePolicies.orgId, orgId!), eq(leavePolicies.timesheetTypeId, type.id))).limit(1);
    if (policy) {
      await db.insert(leaveBalanceEntries).values({
        orgId: orgId!, resourceId: existing.resourceId, timesheetTypeId: type.id, date: existing.date,
        hours: `-${Number(existing.hours).toFixed(2)}`, sourceType: "usage", sourceId: existing.id, createdBy: approverId,
      });
    }
  }

  return ok(row);
}
