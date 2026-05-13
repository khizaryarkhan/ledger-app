/**
 * AR Snapshot at any historical date — QBO-native.
 *
 * GET /api/reports/ar-snapshot?asOf=YYYY-MM-DD
 *
 * Returns an array shaped like rows from the invoices table. Every downstream
 * aging report (AgingByCustomer, AgingByProject, AgingByRegion, AgingByRep,
 * ArHealthReport) consumes this list, so all of them get QBO-native data
 * automatically without UI changes.
 *
 * Implementation: defers to the same engine that powers /api/reports/ar-aging.
 *   - Historical dates → QBO AgedReceivableDetail (authoritative)
 *   - Today           → local engine with qboBalance snapshot
 *
 * Each detail row from the aging engine is converted into a synthetic
 * invoice-shaped record so the aging UI functions can bucket it.
 *
 * Note: Journal Entries are filtered out at the aging-engine layer (to match
 * the user's PBI methodology), so they will not appear in any AR report.
 */

import { db } from "@/db";
import { invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { computeArAging } from "@/lib/ar-aging";
import { fetchQboAging } from "@/lib/qbo-aging-report";
import type { DetailRow } from "@/lib/ar-aging";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const asOf = url.searchParams.get("asOf");
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return bad("asOf=YYYY-MM-DD required");
  }

  const today = new Date().toISOString().slice(0, 10);
  const isHistorical = asOf < today;

  // Fetch aging — QBO for historical, local for today.
  let detail: DetailRow[];
  try {
    if (isHistorical) {
      const qboResult = await fetchQboAging(orgId!, asOf);
      detail = qboResult.detail;
    } else {
      const localResult = await computeArAging(orgId!, asOf, false);
      detail = localResult.detail;
    }
  } catch (e: any) {
    // QBO call failed (token expired, etc.) — fall back to local engine
    const localResult = await computeArAging(orgId!, asOf, false);
    detail = localResult.detail;
  }

  // Load metadata from our invoices table so we can hydrate currency / customer /
  // project linkage on the rows we know about. QBO rows that don't map to
  // anything in our ledger still get a synthetic row so the totals tie.
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
  }).from(invoices).where(eq(invoices.orgId, orgId!));
  const ourInvById = new Map(ourInvs.map(i => [i.id, i]));

  const rows = detail.map((d) => {
    const owned = ourInvById.get(d.txnId);
    const isCm = d.txnType === "Credit Memo";

    // For a CM: openBalance is negative (unapplied credit).
    // For an Invoice: openBalance is the positive remaining amount.
    // Map to our invoice row shape so invBuckets() and downstream functions
    // work without modification.
    if (isCm) {
      return {
        id:              d.txnId,
        customerId:      owned?.customerId ?? d.customerId,
        projectId:       owned?.projectId ?? d.projectId ?? null,
        invoiceNumber:   d.txnNumber,
        invoiceDate:     d.txnDate,
        dueDate:         d.dueDate,
        currency:        d.currency,
        total:           owned?.total ?? d.openBalance, // CMs' face value is negative
        paid:            0,
        qboBalance:      d.openBalance,
        paymentStatus:   "Unpaid",
        collectionStage: "New",
        paidAt:          null,
        qboId:           d.qboId,
        txnType:         "CreditMemo",
        amount:          d.openBalance,
        taxAmount:       0,
        paymentTerms:    30,
      };
    }

    // Invoice
    return {
      id:              d.txnId,
      customerId:      owned?.customerId ?? d.customerId,
      projectId:       owned?.projectId ?? d.projectId ?? null,
      invoiceNumber:   d.txnNumber,
      invoiceDate:     d.txnDate,
      dueDate:         d.dueDate,
      currency:        d.currency,
      // Use the open balance as both total and qboBalance so the downstream
      // bucketers (which use total - paid OR qboBalance) compute the right
      // open amount. We don't have the original gross amount on historical
      // dates without the snapshot.
      total:           owned?.total ?? d.openBalance,
      paid:            owned ? Math.max(0, (owned.total ?? 0) - d.openBalance) : 0,
      qboBalance:      d.openBalance,
      paymentStatus:   "Unpaid",
      collectionStage: "New",
      paidAt:          null,
      qboId:           d.qboId,
      txnType:         "Invoice",
      amount:          d.openBalance,
      taxAmount:       0,
      paymentTerms:    30,
    };
  });

  return ok(rows);
}
