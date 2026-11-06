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
import { timeEntries, timesheetTypes, resources, timesheetBatches, pendingApprovals } from "@/db/schema";
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { postJournalEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import { ensurePayrollClearingAccount } from "@/lib/accounting/system-accounts";
import { requiresApproval, stagePendingApproval } from "@/lib/inventory/approvals";
import { costTimesheetEntries, type CostableEntry, type TimesheetTypeInfo, type ResourceCostInfo } from "@/lib/payroll/timesheet-costing";

const err = (m: string): never => { throw new LedgerValidationError(m); };

/**
 * `approvedAmount` is stamped by the approval stage, never by a caller: on
 * resume the period is reloaded, and if more time was approved in it since,
 * posting a larger figure than the second approver saw would bypass the
 * threshold. Resume refuses instead.
 */
export type TimesheetPostInput = { periodStart: string; periodEnd: string; notes?: string | null; approvedAmount?: number };

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

  if (opts?.skipApprovalCheck && input.approvedAmount != null
      && Math.abs(costing.totalAmount - input.approvedAmount) > 0.005) {
    err(`The approved time in this period changed since it was sent for approval `
      + `(${input.approvedAmount.toFixed(2)} then, ${costing.totalAmount.toFixed(2)} now). `
      + `Reject this approval and post the period again.`);
  }

  if (!opts?.skipApprovalCheck && await requiresApproval(orgId, "timesheet_batch", costing.totalAmount)) {
    // One pending approval per period: pressing Post twice must not queue two.
    const waiting = await db.select({ id: pendingApprovals.id, payload: pendingApprovals.payloadJson })
      .from(pendingApprovals)
      .where(and(eq(pendingApprovals.orgId, orgId), eq(pendingApprovals.entityType, "timesheet_batch"), eq(pendingApprovals.status, "Pending")));
    if (waiting.some(w => (w.payload as any)?.periodStart === input.periodStart && (w.payload as any)?.periodEnd === input.periodEnd)) {
      err("This period is already waiting for approval.");
    }
    const staged = { periodStart: input.periodStart, periodEnd: input.periodEnd, notes: input.notes ?? null, approvedAmount: costing.totalAmount };
    const pending = await stagePendingApproval(orgId, "timesheet_batch", staged, costing.totalAmount, actorId);
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

  // CLAIM the period before posting anything. The unique index on
  // (org, period) decides the winner of two concurrent posts — the old
  // read-then-post let both through and left a duplicate Payroll entry in the
  // GL. neon-http has no transactions, so a failed post releases the claim.
  const [claim] = await db.insert(timesheetBatches).values({
    orgId, periodStart: input.periodStart, periodEnd: input.periodEnd,
    totalHours: costing.totalHours.toString(), totalAmount: costing.totalAmount.toString(),
    status: "posting", createdBy: actorId,
  } as any).onConflictDoNothing().returning({ id: timesheetBatches.id });
  if (!claim) err("This period has already been posted.");

  let entry;
  try {
    entry = await postJournalEntry({
      orgId, entryDate: input.periodEnd, memo: input.notes?.trim() || `Timesheets ${input.periodStart} – ${input.periodEnd}`,
      series: "Payroll", sourceType: "Payroll", createdBy: actorId, lines,
    });
  } catch (e) {
    await db.delete(timesheetBatches).where(eq(timesheetBatches.id, claim.id));
    throw e;
  }

  const batch = { id: claim.id };
  await db.update(timesheetBatches).set({ entryId: entry.id, status: "posted" }).where(eq(timesheetBatches.id, batch.id));

  // Only entries still approved: one returned in the meantime must not be marked posted.
  await db.update(timeEntries).set({ status: "posted", batchId: batch.id, updatedAt: new Date() })
    .where(and(inArray(timeEntries.id, rows.map(r => r.id)), eq(timeEntries.status, "approved")));

  return { id: batch.id, entryId: entry.id, totalHours: costing.totalHours, totalAmount: costing.totalAmount, entryCount: rows.length };
}
