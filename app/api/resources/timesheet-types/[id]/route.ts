/**
 * PATCH /api/resources/timesheet-types/:id   → update
 *
 * No DELETE — a type already used by posted time entries must stay
 * resolvable for historical reporting; set status: 'inactive' instead (same
 * convention as resources/items throughout this app).
 */

import { db } from "@/db";
import { timesheetTypes, accounts, leavePolicies } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq } from "drizzle-orm";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [existing] = await db.select().from(timesheetTypes).where(and(eq(timesheetTypes.id, params.id), eq(timesheetTypes.orgId, orgId!))).limit(1);
  if (!existing) return bad("Timesheet type not found", 404);

  const body = await req.json().catch(() => ({}));
  const { name, billable, requiresAssignable, isPublicHoliday, expenseAccountId, status, sortOrder, leavePolicy } = body ?? {};
  const patch: Record<string, any> = { updatedAt: new Date() };
  if (name != null) {
    if (!String(name).trim()) return bad("name cannot be empty");
    const dup = await db.select({ id: timesheetTypes.id, name: timesheetTypes.name }).from(timesheetTypes).where(eq(timesheetTypes.orgId, orgId!));
    if (dup.some(r => r.id !== params.id && r.name.trim().toLowerCase() === String(name).trim().toLowerCase())) return bad("A timesheet type with this name already exists.");
    patch.name = String(name).trim();
  }
  if (billable !== undefined) patch.billable = existing.category === "work" ? !!billable : false;
  if (requiresAssignable !== undefined) patch.requiresAssignable = existing.category === "work" ? !!requiresAssignable : false;
  if (isPublicHoliday !== undefined) patch.isPublicHoliday = existing.category === "leave" ? !!isPublicHoliday : false;
  if (sortOrder !== undefined) patch.sortOrder = Number(sortOrder) || 0;
  if (status !== undefined) { if (status !== "active" && status !== "inactive") return bad("status must be 'active' or 'inactive'"); patch.status = status; }
  if (expenseAccountId !== undefined) {
    if (!expenseAccountId) return bad("expenseAccountId is required");
    const [acc] = await db.select({ id: accounts.id, classification: accounts.classification, isHeader: accounts.isHeader })
      .from(accounts).where(and(eq(accounts.orgId, orgId!), eq(accounts.id, expenseAccountId))).limit(1);
    if (!acc) return bad("That account was not found in this organisation.");
    if (acc.isHeader) return bad("A header account can't be posted to — choose the account beneath it.");
    if (acc.classification !== "Expense") return bad("The expense account must be of classification Expense.");
    patch.expenseAccountId = expenseAccountId;
  }

  const [row] = await db.update(timesheetTypes).set(patch).where(and(eq(timesheetTypes.id, params.id), eq(timesheetTypes.orgId, orgId!))).returning();

  if (existing.category === "leave" && leavePolicy !== undefined) {
    if (leavePolicy === null) {
      await db.delete(leavePolicies).where(and(eq(leavePolicies.orgId, orgId!), eq(leavePolicies.timesheetTypeId, params.id)));
    } else if (leavePolicy.accrualMethod) {
      if (!["fixed_annual", "monthly"].includes(leavePolicy.accrualMethod)) return bad("accrualMethod must be 'fixed_annual' or 'monthly'");
      const [existingPolicy] = await db.select({ id: leavePolicies.id }).from(leavePolicies)
        .where(and(eq(leavePolicies.orgId, orgId!), eq(leavePolicies.timesheetTypeId, params.id))).limit(1);
      const values = {
        accrualMethod: leavePolicy.accrualMethod,
        accrualAmountPerYear: leavePolicy.accrualAmountPerYear != null ? String(leavePolicy.accrualAmountPerYear) : "0",
        carryForwardCap: leavePolicy.carryForwardCap != null ? String(leavePolicy.carryForwardCap) : null,
        resetMonth: leavePolicy.resetMonth != null ? Number(leavePolicy.resetMonth) : null,
        updatedAt: new Date(),
      };
      if (existingPolicy) await db.update(leavePolicies).set(values).where(eq(leavePolicies.id, existingPolicy.id));
      else await db.insert(leavePolicies).values({ orgId: orgId!, timesheetTypeId: params.id, ...values });
    }
  }

  return ok(row);
}
