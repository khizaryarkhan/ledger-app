/**
 * AR Snapshot at any date — QBO-native first.
 *
 * GET /api/reports/ar-snapshot?asOf=YYYY-MM-DD[&source=qbo|local]
 *
 * Returns an array shaped like rows from the invoices table. Every downstream
 * consumer (Dashboard KPIs + all AR aging reports: AgingByCustomer,
 * AgingByProject, AgingByRegion, AgingByRep) buckets these rows by their
 * dueDate, so they all reconcile to the same grand total automatically.
 *
 * Source of truth:
 *   - PRIMARY: QBO's own AgedReceivableDetail report (via fetchQboAging). This
 *     is the exact engine QBO's UI uses, so our numbers match QBO 1:1 — totals
 *     AND per-bucket figures. Each row ages by its own date (invoices, credit
 *     memos, and journal entries alike), exactly as QBO presents them.
 *   - FALLBACK: the local event-sourced engine (computeArAging), used only when
 *     QBO is not connected or the API call fails. The local fallback does NOT
 *     inject synthetic unapplied-payment / deposit-credit rows — those are a
 *     net-AR reconciliation device that does not appear on QBO's aging report
 *     and previously distorted the Current bucket.
 *
 * To force a source for debugging: ?source=qbo or ?source=local.
 */

import { db } from "@/db";
import { invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, lte } from "drizzle-orm";
import { computeArAging } from "@/lib/ar-aging";
import type { DetailRow } from "@/lib/ar-aging";
import { fetchQboAging } from "@/lib/qbo-aging-report";

/** Subtract `days` from an ISO date (YYYY-MM-DD), returning YYYY-MM-DD.
 *  Used to reconstruct the due date that reproduces QBO's own aging bucket:
 *  for QBO's Report_Date method, daysPastDue = asOf − dueDate, so
 *  dueDate = asOf − daysPastDue. Setting each row's dueDate this way means the
 *  downstream dueDate-based bucketing lands every row in the exact bucket QBO
 *  assigned it, regardless of any QBO-internal aging nuance. */
function shiftDateBack(asOf: string, days: number): string {
  const d = new Date(asOf + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - (Number.isFinite(days) ? days : 0));
  return d.toISOString().slice(0, 10);
}

/** Map a QBO-native aging detail row to our invoice-table row shape. */
function qboRowToInvoiceShape(d: DetailRow, asOf: string) {
  const isCredit = d.txnType === "Credit Memo" || d.openBalance < 0;
  return {
    id:              d.txnId,
    customerId:      d.customerId,
    projectId:       d.projectId ?? null,
    invoiceNumber:   d.txnNumber,
    invoiceDate:     d.txnDate,
    // dueDate reconstructed from QBO's own aging so downstream bucketing == QBO.
    dueDate:         shiftDateBack(asOf, d.daysPastDue),
    currency:        d.currency,
    total:           d.openBalance,   // QBO detail reports open balance only
    paid:            0,
    qboBalance:      d.openBalance,    // signed: invoices +, credits −
    paymentStatus:   "Unpaid",
    collectionStage: "New",
    paidAt:          null,
    qboId:           d.qboId,
    txnType:         isCredit ? "CreditMemo" : "Invoice",
    amount:          d.openBalance,
    taxAmount:       0,
    paymentTerms:    30,
  };
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const asOf = url.searchParams.get("asOf");
  const source = url.searchParams.get("source"); // "qbo" | "local" | null
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return bad("asOf=YYYY-MM-DD required");
  }

  // ── PRIMARY: QBO-native AgedReceivableDetail ────────────────────────────────
  // Mirrors QBO's UI report exactly. Skip only if explicitly forced to local.
  if (source !== "local") {
    try {
      const qbo = await fetchQboAging(orgId!, asOf);
      const rows = qbo.detail
        .filter(d => Math.abs(d.openBalance) >= 0.005)
        .map(d => qboRowToInvoiceShape(d, asOf));
      return ok(rows);
    } catch (qboErr: any) {
      // QBO not connected / token expired / rate limited → fall back to local.
      if (source === "qbo") {
        return bad(`QBO aging unavailable: ${qboErr?.message || String(qboErr)}`, 502);
      }
      // otherwise silently fall through to the local engine below
    }
  }

  // ── FALLBACK: local event-sourced engine ────────────────────────────────────
  // Used when QBO is unreachable. We deliberately do NOT inject synthetic
  // unapplied-payment / deposit-credit rows here — they are a net-AR device that
  // does not appear on QBO's aging report and would distort the buckets.
  const localResult = await computeArAging(orgId!, asOf, false);
  const detail: DetailRow[] = localResult.detail;

  // Hydrate currency / customer / project linkage from our invoices table.
  const ourInvs = await db.select({
    id:           invoices.id,
    customerId:   invoices.customerId,
    projectId:    invoices.projectId,
    currency:     invoices.currency,
    total:        invoices.total,
    invoiceDate:  invoices.invoiceDate,
    dueDate:      invoices.dueDate,
    qboId:        invoices.qboId,
    txnType:      invoices.txnType,
  }).from(invoices).where(and(eq(invoices.orgId, orgId!), lte(invoices.invoiceDate, asOf)));
  const ourInvById = new Map(ourInvs.map(i => [i.id, i]));

  const rows = detail
    .filter(d => Math.abs(d.openBalance) >= 0.005)
    .map((d) => {
      const owned = ourInvById.get(d.txnId);
      const isCredit = d.txnType === "Credit Memo" || d.openBalance < 0;
      return {
        id:              d.txnId,
        customerId:      owned?.customerId ?? d.customerId,
        projectId:       owned?.projectId ?? d.projectId ?? null,
        invoiceNumber:   d.txnNumber,
        invoiceDate:     d.txnDate,
        dueDate:         d.dueDate,
        currency:        d.currency,
        total:           owned?.total ?? d.openBalance,
        paid:            0,
        qboBalance:      d.openBalance,
        paymentStatus:   "Unpaid",
        collectionStage: "New",
        paidAt:          null,
        qboId:           d.qboId,
        txnType:         isCredit ? "CreditMemo" : "Invoice",
        amount:          d.openBalance,
        taxAmount:       0,
        paymentTerms:    30,
      };
    });

  return ok(rows);
}
