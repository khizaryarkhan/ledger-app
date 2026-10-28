/**
 * GET /api/accounting/adjustments?from=&to=
 *
 * Credits & adjustments (0116): credit notes / refunds / vendor credits by
 * reason, manual journals by purpose, supplier-bill capture lag, and
 * documents edited after posting. Native ledger entries only. Read-only.
 */

import { db } from "@/db";
import { journalEntries, journalLines } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, gte, lte, inArray, isNull, sql } from "drizzle-orm";
import { isIsoDate } from "@/lib/inventory/delivery-performance";
import { reasonLabel, captureLagDays, CREDIT_TYPES } from "@/lib/accounting/entry-reasons";

const TYPES = ["CreditNote", "RefundReceipt", "VendorCredit", "Manual", "Bill", "Expense", "Invoice", "SalesReceipt"];
const r2 = (v: number) => Math.round(v * 100) / 100;

type Group = { code: string; label: string; count: number; amount: number };
function group(rows: { type: string; reasonCode: string | null; amount: number }[]): Group[] {
  const m = new Map<string, Group>();
  for (const r of rows) {
    const code = r.reasonCode ?? "unrecorded";
    const g = m.get(code) ?? { code, label: r.reasonCode ? reasonLabel(r.type, r.reasonCode) : "Not recorded", count: 0, amount: 0 };
    g.count += 1; g.amount += r.amount;
    m.set(code, g);
  }
  return [...m.values()].map(g => ({ ...g, amount: r2(g.amount) })).sort((a, b) => b.amount - a.amount);
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const q = new URL(req.url).searchParams;
  const to = q.get("to") || new Date().toISOString().slice(0, 10);
  const from = q.get("from") || `${to.slice(0, 4)}-01-01`;
  if (!isIsoDate(from) || !isIsoDate(to)) return bad("from/to must be YYYY-MM-DD");

  // Mirrored provider entries (external_id set) are QBO/Xero's books, not ours.
  const entries = await db.select({
    id: journalEntries.id, type: journalEntries.sourceType, docNumber: journalEntries.docNumber, entryDate: journalEntries.entryDate,
    reasonCode: journalEntries.reasonCode, receivedDate: journalEntries.receivedDate, memo: journalEntries.memo,
    updatedAt: journalEntries.updatedAt,
  }).from(journalEntries).where(and(
    eq(journalEntries.orgId, orgId!), eq(journalEntries.status, "Posted"), isNull(journalEntries.externalId),
    inArray(journalEntries.sourceType, TYPES), gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to),
  ));
  if (!entries.length) return ok({ from, to, empty: true });

  // An entry's value = its total debits (both sides balance).
  const totals = await db.select({ entryId: journalLines.entryId, amount: sql<string>`sum(${journalLines.debit})` })
    .from(journalLines).where(and(eq(journalLines.orgId, orgId!), inArray(journalLines.entryId, entries.map(e => e.id))))
    .groupBy(journalLines.entryId);
  const amountOf = new Map(totals.map(t => [t.entryId, Number(t.amount) || 0]));
  const rows = entries.map(e => ({ ...e, amount: amountOf.get(e.id) ?? 0 }));

  const sum = (a: typeof rows) => r2(a.reduce((s, r) => s + r.amount, 0));
  const sales = sum(rows.filter(r => r.type === "Invoice" || r.type === "SalesReceipt"));
  const bills = rows.filter(r => r.type === "Bill" || r.type === "Expense");
  const purchases = sum(bills);
  const customerCredits = rows.filter(r => r.type === "CreditNote" || r.type === "RefundReceipt");
  const supplierCredits = rows.filter(r => r.type === "VendorCredit");
  const journals = rows.filter(r => r.type === "Manual");
  const lags = bills.map(b => captureLagDays(b.entryDate, b.receivedDate)).filter((d): d is number => d != null);
  const edited = rows.filter(r => r.updatedAt);
  const reasoned = (t: string) => CREDIT_TYPES.has(t) || t === "Manual";

  return ok({
    from, to,
    customerCredits: {
      count: customerCredits.length, amount: sum(customerCredits),
      pctOfSales: sales > 0 ? Math.round((sum(customerCredits) / sales) * 1000) / 10 : null,
      byReason: group(customerCredits),
    },
    supplierCredits: {
      count: supplierCredits.length, amount: sum(supplierCredits),
      pctOfPurchases: purchases > 0 ? Math.round((sum(supplierCredits) / purchases) * 1000) / 10 : null,
      byReason: group(supplierCredits),
    },
    journals: { count: journals.length, amount: sum(journals), byReason: group(journals) },
    billCapture: {
      bills: bills.length,
      withReceivedDate: lags.length,
      avgLagDays: lags.length ? Math.round((lags.reduce((s, d) => s + d, 0) / lags.length) * 10) / 10 : null,
      over7Days: lags.filter(d => d > 7).length,
    },
    editedAfterPosting: edited.length,
    lines: rows
      .filter(r => reasoned(r.type) || r.updatedAt)
      .sort((a, b) => b.entryDate.localeCompare(a.entryDate))
      .slice(0, 500)
      .map(r => ({
        id: r.id, type: r.type, docNumber: r.docNumber, date: r.entryDate, amount: r2(r.amount),
        reason: reasoned(r.type) ? reasonLabel(r.type, r.reasonCode) : null,
        unrecorded: reasoned(r.type) && !r.reasonCode,
        memo: r.memo, editedAt: r.updatedAt,
      })),
  });
}
