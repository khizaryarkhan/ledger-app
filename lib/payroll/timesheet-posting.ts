/**
 * Posting approved timesheets for a period — the only thing that ever writes
 * real labour expense to the GL. Mirrors lib/inventory/mo-completion.ts's
 * shape: a read-only preview the UI shows before confirming, then a commit
 * that validates, stages for approval if the org's threshold requires it,
 * and posts exactly once.
 *
 * One entry per run, grouped by (expense account, assignable dimension) —
 * never one GL line per resource. Per-resource detail stays in time_entries
 * (the subledger); Payroll Clearing is the credit side, cleared later by a
 * real payroll Bill/Payment, same idiom as GR/IR.
 */

import { db } from "@/db";
import { timeEntries, timesheetTypes, resources, timesheetBatches } from "@/db/schema";
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { postJournalEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import { ensurePayrollClearingAccount } from "@/lib/accounting/system-accounts";
import { requiresApproval, stagePendingApproval } from "@/lib/inventory/approvals";
import { costTimesheetEntries, type CostableEntry, type TimesheetTypeInfo, type ResourceCostInfo } from "@/lib/payroll/timesheet-costing";

const err = (m: string): never => { throw new LedgerValidationError(m); };

export type TimesheetPostInput = { periodStart: string; periodEnd: string; notes?: string | null };

async function loadApprovedEntries(orgId: string, periodStart: string, periodEnd: string) {
  const rows = await db.select().from(timeEntries).where(and(
    eq(timeEntries.orgId, orgId),
    eq(timeEntries.status, "approved"),
    gte(timeEntries.date, periodStart),
    lte(timeEntries.date, periodEnd),
  ));
  if (!rows.length) err("No approved, unposted time entries fall in this period.");

  const typeIds = [...new Set(rows.map(r => r.timesheetTypeId))];
  const resourceIds = [...new Set(rows.map(r => r.resourceId))];
  const [typeRows, resourceRows] = await Promise.all([
    db.select({ id: timesheetTypes.id, expenseAccountId: timesheetTypes.expenseAccountId })
      .from(timesheetTypes).where(and(eq(timesheetTypes.orgId, orgId), inArray(timesheetTypes.id, typeIds))),
    db.select({ id: resources.id, costRatePerHour: resources.costRatePerHour })
      .from(resources).where(and(eq(resources.orgId, orgId), inArray(resources.id, resourceIds))),
  ]);
  const typesById = new Map<string, TimesheetTypeInfo>(typeRows.map(t => [t.id, { expenseAccountId: t.expenseAccountId }]));
  const resourcesById = new Map<string, ResourceCostInfo>(
    resourceRows.map(r => [r.id, { costRatePerHour: r.costRatePerHour == null ? null : Number(r.costRatePerHour) }]),
  );

  const entries: CostableEntry[] = rows.map(r => ({
    id: r.id, hours: Number(r.hours), resourceId: r.resourceId, timesheetTypeId: r.timesheetTypeId,
    assignableType: r.assignableType, assignableId: r.assignableId,
  }));
  return { rows, entries, typesById, resourcesById };
}

/** Read-only — exactly what the "Post timesheets" preview shows before confirming. */
export async function previewPost(orgId: string, input: TimesheetPostInput) {
  const { rows, entries, typesById, resourcesById } = await loadApprovedEntries(orgId, input.periodStart, input.periodEnd);
  const costing = costTimesheetEntries(entries, typesById, resourcesById);
  return { ...costing, entryCount: rows.length };
}

/** Post one completion for the period. Returns the batch, or a pending approval. */
export async function postTimesheets(orgId: string, input: TimesheetPostInput, actorId: string | null, opts?: { skipApprovalCheck?: boolean }) {
  const { rows, entries, typesById, resourcesById } = await loadApprovedEntries(orgId, input.periodStart, input.periodEnd);
  const costing = costTimesheetEntries(entries, typesById, resourcesById);
  if (costing.unrated.length > 0) {
    err(`${costing.unrated.length} time ${costing.unrated.length === 1 ? "entry has" : "entries have"} no resource cost rate set — `
      + `set a cost rate on every resource in this period before posting.`);
  }
  if (costing.totalAmount <= 0) err("Nothing to post — every entry in this period costs zero.");

  const [existing] = await db.select({ id: timesheetBatches.id }).from(timesheetBatches)
    .where(and(eq(timesheetBatches.orgId, orgId), eq(timesheetBatches.periodStart, input.periodStart), eq(timesheetBatches.periodEnd, input.periodEnd)))
    .limit(1);
  if (existing) err("This period has already been posted.");

  if (!opts?.skipApprovalCheck && await requiresApproval(orgId, "timesheet_batch", costing.totalAmount)) {
    const pending = await stagePendingApproval(orgId, "timesheet_batch", input, costing.totalAmount, actorId);
    return { pending: true, id: pending.id, amount: costing.totalAmount };
  }

  const clearingAccountId = await ensurePayrollClearingAccount(orgId);
  const lines: PostLine[] = costing.groups
    .filter(g => g.amount > 0)
    .map(g => ({
      accountId: g.accountId,
      debit: g.amount,
      description: g.assignableId
        ? `Timesheets ${input.periodStart} – ${input.periodEnd} (${g.assignableType}:${g.assignableId})`
        : `Timesheets ${input.periodStart} – ${input.periodEnd}`,
    }));
  lines.push({ accountId: clearingAccountId, credit: costing.totalAmount, description: `Payroll clearing — ${input.periodStart} – ${input.periodEnd}` });

  const entry = await postJournalEntry({
    orgId, entryDate: input.periodEnd, memo: input.notes?.trim() || `Timesheets ${input.periodStart} – ${input.periodEnd}`,
    series: "Payroll", sourceType: "Payroll", createdBy: actorId, lines,
  });

  const [batch] = await db.insert(timesheetBatches).values({
    orgId, periodStart: input.periodStart, periodEnd: input.periodEnd, entryId: entry.id,
    totalHours: costing.totalHours.toString(), totalAmount: costing.totalAmount.toString(),
    status: "posted", createdBy: actorId,
  } as any).returning({ id: timesheetBatches.id });

  await db.update(timeEntries).set({ status: "posted", batchId: batch.id, updatedAt: new Date() })
    .where(inArray(timeEntries.id, rows.map(r => r.id)));

  return { id: batch.id, entryId: entry.id, totalHours: costing.totalHours, totalAmount: costing.totalAmount, entryCount: rows.length };
}
