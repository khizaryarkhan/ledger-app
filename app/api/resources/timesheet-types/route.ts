/**
 * GET  /api/resources/timesheet-types   → list timesheet types (?status=)
 * POST /api/resources/timesheet-types   → create a timesheet type
 *
 * A Timesheet Type is the org-configurable category a time entry is logged
 * against ("Work", "Sick time", "Holiday - UK", "R&D", ...) — deliberately
 * not an ap_item (it's an expense classification, not a buyable/sellable
 * thing), same shape as Classes/Tax Rates/Cost Centres under Accounting ->
 * Setup, with the extra fields a time category needs.
 */

import { db } from "@/db";
import { timesheetTypes, accounts, leavePolicies } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, desc } from "drizzle-orm";

const CATEGORIES = ["work", "leave", "internal"] as const;

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const conds = [eq(timesheetTypes.orgId, orgId!)];
  if (status === "active" || status === "inactive") conds.push(eq(timesheetTypes.status, status));

  const rows = await db.select().from(timesheetTypes).where(and(...conds)).orderBy(desc(timesheetTypes.createdAt));
  const policies = await db.select().from(leavePolicies).where(eq(leavePolicies.orgId, orgId!));
  const policyByType = new Map(policies.map(p => [p.timesheetTypeId, p]));
  return ok(rows.map(r => ({ ...r, leavePolicy: policyByType.get(r.id) ?? null })));
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const body = await req.json().catch(() => ({}));
  const { name, category, billable, requiresAssignable, isPublicHoliday, expenseAccountId, status, leavePolicy } = body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) return bad("name is required");
  if (!CATEGORIES.includes(category)) return bad("category must be 'work', 'leave' or 'internal'");
  if (!expenseAccountId || typeof expenseAccountId !== "string") return bad("expenseAccountId is required");

  const [acc] = await db.select({ id: accounts.id, classification: accounts.classification, isHeader: accounts.isHeader })
    .from(accounts).where(and(eq(accounts.orgId, orgId!), eq(accounts.id, expenseAccountId))).limit(1);
  if (!acc) return bad("That account was not found in this organisation.");
  if (acc.isHeader) return bad("A header account can't be posted to — choose the account beneath it.");
  if (acc.classification !== "Expense") return bad("The expense account must be of classification Expense.");

  // App-level case-insensitive uniqueness, same pattern as lib/inventory/item-name.ts
  // — not a DB index, since existing duplicates may predate this check.
  const existing = await db.select({ id: timesheetTypes.id, name: timesheetTypes.name }).from(timesheetTypes).where(eq(timesheetTypes.orgId, orgId!));
  if (existing.some(r => r.name.trim().toLowerCase() === name.trim().toLowerCase())) return bad("A timesheet type with this name already exists.");

  const [row] = await db.insert(timesheetTypes).values({
    orgId: orgId!,
    name: name.trim(),
    category,
    billable: category === "work" ? !!billable : false,
    requiresAssignable: category === "work" ? (requiresAssignable ?? true) : false,
    isPublicHoliday: category === "leave" ? !!isPublicHoliday : false,
    expenseAccountId,
    status: status === "inactive" ? "inactive" : "active",
  }).returning();

  if (category === "leave" && leavePolicy && leavePolicy.accrualMethod) {
    if (!["fixed_annual", "monthly"].includes(leavePolicy.accrualMethod)) return bad("accrualMethod must be 'fixed_annual' or 'monthly'");
    await db.insert(leavePolicies).values({
      orgId: orgId!,
      timesheetTypeId: row.id,
      accrualMethod: leavePolicy.accrualMethod,
      accrualAmountPerYear: leavePolicy.accrualAmountPerYear != null ? String(leavePolicy.accrualAmountPerYear) : "0",
      carryForwardCap: leavePolicy.carryForwardCap != null ? String(leavePolicy.carryForwardCap) : null,
      resetMonth: leavePolicy.resetMonth != null ? Number(leavePolicy.resetMonth) : null,
    });
  }

  return ok(row);
}
