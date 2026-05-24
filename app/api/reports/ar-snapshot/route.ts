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
import type { DetailRow } from "@/lib/ar-aging";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const asOf = url.searchParams.get("asOf");
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return bad("asOf=YYYY-MM-DD required");
  }

  // Always use the local engine. The Aging by Customer / Project / Region /
  // Rep tabs all consume this snapshot, so they're now all computed from our
  // synced data — invoices, payments, payment_applications (incl. JE
  // applications with per-line netting), JEs, deposits.
  const localResult = await computeArAging(orgId!, asOf, false);
  const detail: DetailRow[] = localResult.detail;

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

  // Unapplied payment amounts per customer (from the payments table).
  // The aging engine deducts these from the per-customer summary. We inject
  // synthetic CreditMemo rows so every downstream report produces the same
  // grand total as the main AR Aging report.
  const unappliedByCustomer: Record<string, number> = localResult.unappliedByCustomer ?? {};

  // Deposit credits per customer (QBO Deposit AR lines with negative amount).
  // These are NETTED against the customer's open invoice rows oldest-first
  // (matching QBO's behaviour when a deposit has been applied against an
  // invoice). Any credit remaining after netting all invoices gets a synthetic
  // CreditMemo row. This prevents customers from appearing twice — once for
  // their open invoice and once for the deposit credit that offsets it.
  const depositCreditsRemaining: Record<string, number> = {
    ...(localResult.depositCreditsByCustomer ?? {}),
  };

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

    // Non-CM rows with a negative openBalance are AR credits (e.g. a credit
    // Journal Entry line or a negative Deposit).  If we map them as "Invoice"
    // the Dashboard would include them in grossReceivable (correctly reducing
    // it) while Reports' invBuckets() would silently drop them with its
    // `if (out <= 0) return b` guard — causing a mismatch equal to the sum of
    // those credits.  Mapping them as CreditMemo lets every downstream
    // consumer (Dashboard activeCMs filter, invBuckets CM path, arByRegion
    // activeCMs loop) apply the same negative-credit logic consistently.
    if (d.openBalance < 0) {
      return {
        id:              d.txnId,
        customerId:      owned?.customerId ?? d.customerId,
        projectId:       owned?.projectId ?? d.projectId ?? null,
        invoiceNumber:   d.txnNumber,
        invoiceDate:     d.txnDate,
        dueDate:         d.dueDate,
        currency:        d.currency,
        total:           d.openBalance,
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

    // Invoice (positive open balance).
    // Net any deposit credit for this customer against this invoice row.
    // This mirrors QBO's behaviour: when a Deposit has been applied against an
    // invoice, the invoice's open balance is reduced (and may reach zero).
    // We apply credits oldest-overdue-first — detail rows arrive ordered by
    // txnDate ascending from the aging engine.
    const custId = owned?.customerId ?? d.customerId;
    let effectiveOpenBalance = d.openBalance;
    const depositCredit = depositCreditsRemaining[custId] ?? 0;
    if (depositCredit > 0.005 && effectiveOpenBalance > 0.005) {
      const applied = Math.min(depositCredit, effectiveOpenBalance);
      depositCreditsRemaining[custId] = depositCredit - applied;
      effectiveOpenBalance = effectiveOpenBalance - applied;
    }
    // If the deposit credit fully covers this invoice, drop the row (balance = 0).
    if (effectiveOpenBalance < 0.005) return null;

    return {
      id:              d.txnId,
      customerId:      custId,
      projectId:       owned?.projectId ?? d.projectId ?? null,
      invoiceNumber:   d.txnNumber,
      invoiceDate:     d.txnDate,
      dueDate:         d.dueDate,
      currency:        d.currency,
      total:           owned?.total ?? effectiveOpenBalance,
      paid:            owned ? Math.max(0, (owned.total ?? 0) - effectiveOpenBalance) : 0,
      qboBalance:      effectiveOpenBalance,
      paymentStatus:   "Unpaid",
      collectionStage: "New",
      paidAt:          null,
      qboId:           d.qboId,
      txnType:         "Invoice",
      amount:          effectiveOpenBalance,
      taxAmount:       0,
      paymentTerms:    30,
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  // Synthetic CreditMemo rows for unapplied payments (from the payments table).
  for (const [custId, unapplied] of Object.entries(unappliedByCustomer)) {
    if (unapplied < 0.005) continue;
    rows.push({
      id:              `__unapplied__${custId}`,
      customerId:      custId,
      projectId:       null,
      invoiceNumber:   "Unapplied Payment",
      invoiceDate:     asOf,
      dueDate:         asOf,
      currency:        "EUR",
      total:           -unapplied,
      paid:            0,
      qboBalance:      -unapplied,
      paymentStatus:   "Unpaid",
      collectionStage: "New",
      paidAt:          null,
      qboId:           null,
      txnType:         "CreditMemo",
      amount:          -unapplied,
      taxAmount:       0,
      paymentTerms:    0,
    });
  }

  // Synthetic CreditMemo rows for any deposit credit that was NOT fully
  // consumed by netting against invoice rows above. This happens when a
  // customer has deposit credits but no (or fewer) open invoices to offset.
  for (const [custId, remaining] of Object.entries(depositCreditsRemaining)) {
    if (remaining < 0.005) continue;
    rows.push({
      id:              `__deposit_credit__${custId}`,
      customerId:      custId,
      projectId:       null,
      invoiceNumber:   "Deposit Credit",
      invoiceDate:     asOf,
      dueDate:         asOf,
      currency:        "EUR",
      total:           -remaining,
      paid:            0,
      qboBalance:      -remaining,
      paymentStatus:   "Unpaid",
      collectionStage: "New",
      paidAt:          null,
      qboId:           null,
      txnType:         "CreditMemo",
      amount:          -remaining,
      taxAmount:       0,
      paymentTerms:    0,
    });
  }

  return ok(rows);
}
