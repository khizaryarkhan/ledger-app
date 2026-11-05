// Server-side totals for PAX Console's `analyze` tool: receivables grouped by
// stage / customer / bucket / escalation, and payments received in a date range.
//
// Read-only. It reuses the AR aging engine (the same numbers as the AR Aging
// report) and applies the same rep scope the invoice list does, so a rep sees
// only their own book — and, like every PAX Console call, it runs as the
// signed-in user (the tool layer replays the call under their token).

import { z } from "zod";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { customers, invoices, payments, projects } from "@/db/schema";
import { bad, ok, requireOrg } from "@/lib/api";
import { computeArAging } from "@/lib/ar-aging";
import { today } from "@/lib/format";
import { getRepScope } from "@/lib/rep-scope";
import {
  MAX_LIMIT, MAX_RANGE_DAYS, PAYMENT_GROUPS, RECEIVABLE_GROUPS, daysBetween, filterReceivables,
  summarisePayments, summariseReceivables, type ArRow, type PaymentRow,
} from "@/lib/pax/analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD.");
const Body = z.object({
  dataset: z.enum(["receivables", "payments"]),
  groupBy: z.enum([...RECEIVABLE_GROUPS, ...PAYMENT_GROUPS] as [string, ...string[]]).optional(),
  asOf: date.optional(),
  from: date.optional(),
  to: date.optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
  withRows: z.boolean().optional(),
  filters: z.object({
    stage: z.array(z.string().max(80)).max(20).optional(),
    bucket: z.array(z.string().max(20)).max(6).optional(),
    customer: z.string().max(120).optional(),
    currency: z.string().max(8).optional(),
    escalatedTo: z.string().max(120).optional(),
    minDaysPastDue: z.number().int().min(-3650).max(3650).optional(),
    disputed: z.boolean().optional(),
  }).strict().optional(),
}).strict();

export async function POST(req: Request) {
  const { error, orgId, role, repId } = await requireOrg();
  if (error) return error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Check the arguments.");
  const b = parsed.data;
  const scope = await getRepScope(orgId!, role, repId);

  if (b.dataset === "receivables") {
    if (b.groupBy && !(RECEIVABLE_GROUPS as readonly string[]).includes(b.groupBy)) {
      return bad(`For receivables, groupBy is one of: ${RECEIVABLE_GROUPS.join(", ")}.`);
    }
    const asOf = b.asOf ?? today();
    const [aging, invRows, custRows, projRows] = await Promise.all([
      computeArAging(orgId!, asOf),
      db.select({
        id: invoices.id, stage: invoices.collectionStage, escalatedTo: invoices.escalatedToName, escalationType: invoices.escalationType,
        dispute: invoices.disputeReason, promise: invoices.promiseDate,
      }).from(invoices).where(and(eq(invoices.orgId, orgId!), isNull(invoices.deletedAt))),
      db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.orgId, orgId!)),
      db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, orgId!)),
    ]);
    const inv = new Map(invRows.map((r) => [r.id, r]));
    const cust = new Map(custRows.map((r) => [r.id, r.name]));
    const proj = new Map(projRows.map((r) => [r.id, r.name]));

    const rows: ArRow[] = aging.detail
      .filter((d) => d.openBalance !== 0)
      .filter((d) => !scope || (d.txnType === "Invoice" ? scope.invoiceIds.has(d.txnId) : scope.customerIds.has(d.customerId)))
      .map((d) => {
        const meta = d.txnType === "Invoice" ? inv.get(d.txnId) : undefined;
        return {
          customerId: d.customerId,
          customer: cust.get(d.customerId) ?? "",
          project: d.projectId ? proj.get(d.projectId) ?? null : null,
          txnType: d.txnType,
          txnNumber: d.txnNumber,
          txnDate: d.txnDate,
          dueDate: d.dueDate,
          currency: d.currency,
          openBalance: d.openBalance,
          daysPastDue: d.daysPastDue,
          bucket: d.bucket,
          stage: meta?.stage || (d.txnType === "Invoice" ? "No stage" : d.txnType),
          escalatedTo: meta?.escalatedTo ?? null,
          escalationType: meta?.escalationType ?? null,
          disputed: !!meta?.dispute,
          promiseDate: meta?.promise ?? null,
        };
      });

    const filtered = filterReceivables(rows, b.filters ?? {});
    const s = summariseReceivables(filtered, { groupBy: b.groupBy as never, limit: b.limit, withRows: b.withRows });
    return ok({
      dataset: "receivables", asOf, groupBy: b.groupBy ?? null, filters: b.filters ?? {}, matched: filtered.length,
      totals: s.totals, groups: s.groups, moreGroups: s.moreGroups, rows: s.rows, moreRows: s.moreRows,
      note: "Open balances come from the AR aging engine (synced invoices, credit memos and journals; credits are negative), the same figures as the AR Aging report. Totals are per currency and are never added across currencies. Unapplied customer payments are not included.",
    });
  }

  // payments
  if (b.groupBy && !(PAYMENT_GROUPS as readonly string[]).includes(b.groupBy)) {
    return bad(`For payments, groupBy is one of: ${PAYMENT_GROUPS.join(", ")}.`);
  }
  const to = b.to ?? b.from ?? today();
  const from = b.from ?? to;
  if (from > to) return bad("from must not be after to.");
  if (daysBetween(from, to) > MAX_RANGE_DAYS) return bad(`Ask for at most ${MAX_RANGE_DAYS} days at a time.`);

  const [payRows, custRows] = await Promise.all([
    db.select({
      id: payments.id, customerId: payments.customerId, txnDate: payments.txnDate, total: payments.totalAmount, unapplied: payments.unappliedAmount,
      currency: payments.currency, method: payments.paymentMethod, ref: payments.paymentRef, deposit: payments.depositAccountName,
    }).from(payments).where(and(eq(payments.orgId, orgId!), gte(payments.txnDate, from), lte(payments.txnDate, to))),
    db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.orgId, orgId!)),
  ]);
  const cust = new Map(custRows.map((r) => [r.id, r.name]));
  const rows: PaymentRow[] = payRows
    .filter((p) => !scope || (p.customerId !== null && scope.customerIds.has(p.customerId)))
    .map((p) => ({
      id: p.id, customerId: p.customerId, customer: p.customerId ? cust.get(p.customerId) ?? "" : "", txnDate: p.txnDate,
      totalAmount: p.total, unappliedAmount: p.unapplied, currency: p.currency, method: p.method, ref: p.ref, depositAccount: p.deposit,
    }));
  const s = summarisePayments(rows, { groupBy: b.groupBy as never, limit: b.limit });
  return ok({
    dataset: "payments", from, to, groupBy: b.groupBy ?? null, matched: rows.length,
    totals: s.totals, groups: s.groups, moreGroups: s.moreGroups, payments: s.rows, morePayments: s.moreRows,
    note: "Payments synced from QuickBooks or Xero. A payment entered very recently may not have synced yet; an admin can check QuickBooks live with qbo_api.",
  });
}
