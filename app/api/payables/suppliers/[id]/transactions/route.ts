/**
 * Unified transactions for a supplier — every document type that names this
 * supplier, in one chronological feed. Modelled directly on
 * app/api/customers/[id]/transactions/route.ts (QBO's own Customer →
 * Transactions tab); this is the Vendor-side equivalent, which previously
 * existed only as a Bills-only list with Purchase Orders split into a
 * separate tab.
 *
 * Sources, and why each is read the way it is:
 *  - Bills: ap_bills.supplierId — already the bridge/mirror for BOTH native
 *    and QBO/Xero-synced bills (bridgeNativeBill), so this alone covers both.
 *  - Expense / Vendor Credit / Bill Payment: these have no bridge table of
 *    their own. They post natively via lib/accounting/documents.ts, which
 *    stamps nameType="Vendor"/nameId=<supplierId> on the document's own
 *    control line (lib/accounting/documents.ts's `name()` helper) — so for a
 *    NATIVE org these are read straight from journal_lines/journal_entries.
 *    A QBO/Xero-synced org has no local copy of these at all (only Bills are
 *    mirrored) — the query correctly returns nothing for them, rather than
 *    guessing.
 *  - Purchase Orders: TWO real tables carry this concept in this app (see
 *    CLAUDE.md's "known, deliberate duplication" note) — Payables' own
 *    purchase_orders (pushed to QBO/Xero via lib/po-push.ts) and the
 *    trade_documents "PurchaseOrder" kind (native, non-accounting, feeds
 *    Receiving). Both are shown; only the former has a confirmed detail page
 *    (/payables/purchase-orders/[id]) to link to.
 *  - Goods Receipts: goods_receipts.supplierId.
 *
 * GET /api/payables/suppliers/[id]/transactions
 */

import { db } from "@/db";
import {
  apSuppliers, apBills, purchaseOrders, tradeDocuments, goodsReceipts,
  journalEntries, journalLines,
} from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, inArray } from "drizzle-orm";

export type SupplierTxn = {
  id: string;
  refId: string;
  txnDate: string;
  type: "Bill" | "Expense" | "Vendor Credit" | "Bill Payment" | "Purchase Order" | "Goods Receipt";
  number: string | null;
  amount: number;        // signed: positive = increases what we owe, negative = reduces it
  balance: number;        // open balance (unpaid bill) — always >= 0
  currency: string;
  status: string;
  memo: string | null;
  viewHref: string | null; // null = no confirmed detail page for this row yet
  meta?: Record<string, any>;
};

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [supplier] = await db.select({ id: apSuppliers.id, currency: apSuppliers.currency })
    .from(apSuppliers)
    .where(and(eq(apSuppliers.id, params.id), eq(apSuppliers.orgId, orgId!)))
    .limit(1);
  if (!supplier) return bad("Supplier not found", 404);
  const homeCcy = supplier.currency || "EUR";

  const [bills, payablesPOs, nativePOs, grs, apJournalRows] = await Promise.all([
    db.select().from(apBills).where(and(eq(apBills.orgId, orgId!), eq(apBills.supplierId, supplier.id))),
    db.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, orgId!), eq(purchaseOrders.supplierId, supplier.id))),
    db.select().from(tradeDocuments).where(and(eq(tradeDocuments.orgId, orgId!), eq(tradeDocuments.kind, "PurchaseOrder"), eq(tradeDocuments.partyId, supplier.id))),
    db.select().from(goodsReceipts).where(and(eq(goodsReceipts.orgId, orgId!), eq(goodsReceipts.supplierId, supplier.id))),
    db.select({
      entryId: journalEntries.id, docNumber: journalEntries.docNumber, entryDate: journalEntries.entryDate,
      sourceType: journalEntries.sourceType, status: journalEntries.status, memo: journalEntries.memo,
      debit: journalLines.debit, credit: journalLines.credit, currency: journalLines.currency,
    }).from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(and(
        eq(journalLines.orgId, orgId!), eq(journalLines.nameType, "Vendor"), eq(journalLines.nameId, supplier.id),
        inArray(journalEntries.sourceType, ["Expense", "VendorCredit", "BillPayment"]),
      )),
  ]);

  const rows: SupplierTxn[] = [];

  // Bills — covers both native-bridged and QBO/Xero-synced bills.
  for (const b of bills) {
    rows.push({
      id: `bill-${b.id}`, refId: b.id, txnDate: b.billDate || "", type: "Bill",
      number: b.billNumber, amount: b.total ?? 0, balance: Math.max(0, b.balance ?? 0),
      currency: b.currency || homeCcy,
      status: b.accountingPaymentStatus ?? ((b.balance ?? 0) > 0 ? "Unpaid" : "Paid"),
      memo: b.privateNote, viewHref: `/payables/bills/${b.id}`,
      meta: { workflowStatus: b.workflowStatus, approvalStatus: b.approvalStatus },
    });
  }

  // Expense / Vendor Credit / Bill Payment — native-only (see file header).
  // Sign convention mirrors the customer feed (Bill is "+", everything that
  // reduces what's owed is "-"): a Vendor Credit or Bill Payment offsets a
  // Bill the same way a Payment/Credit Memo offsets an Invoice there.
  const AP_TYPE_LABEL: Record<string, SupplierTxn["type"]> = {
    Expense: "Expense", VendorCredit: "Vendor Credit", BillPayment: "Bill Payment",
  };
  const AP_SIGN: Record<string, 1 | -1> = { Expense: -1, VendorCredit: -1, BillPayment: -1 };
  for (const j of apJournalRows) {
    if (j.status === "Reversed") continue;
    const type = AP_TYPE_LABEL[j.sourceType];
    if (!type) continue;
    const magnitude = Math.abs(Number(j.debit) - Number(j.credit));
    rows.push({
      id: `je-${j.entryId}`, refId: j.entryId, txnDate: j.entryDate, type,
      number: j.docNumber, amount: AP_SIGN[j.sourceType] * magnitude, balance: 0,
      currency: j.currency || homeCcy, status: "Posted", memo: j.memo,
      viewHref: `/accounting/transactions/${j.entryId}`,
    });
  }

  // Purchase Orders — Payables' own table (has a confirmed detail page).
  for (const po of payablesPOs) {
    rows.push({
      id: `po-${po.id}`, refId: po.id, txnDate: po.poDate || "", type: "Purchase Order",
      number: po.poNumber, amount: po.total ?? 0, balance: 0, currency: po.currency || homeCcy,
      status: po.status, memo: po.notes, viewHref: `/payables/purchase-orders/${po.id}`,
      meta: { source: "payables" },
    });
  }
  // Purchase Orders — native trade_documents (non-accounting, feeds
  // Receiving). No confirmed standalone detail page exists for this table
  // yet, so it's shown read-only in the feed rather than linking somewhere
  // unverified.
  for (const po of nativePOs) {
    rows.push({
      id: `tpo-${po.id}`, refId: po.id, txnDate: po.issueDate, type: "Purchase Order",
      number: po.docNumber, amount: Number(po.total) || 0, balance: 0, currency: po.currency || homeCcy,
      status: po.status, memo: po.memo, viewHref: null,
      meta: { source: "trade_documents" },
    });
  }

  // Goods Receipts.
  for (const gr of grs) {
    if (gr.status === "Reversed") continue;
    rows.push({
      id: `gr-${gr.id}`, refId: gr.id, txnDate: String(gr.receiptDate), type: "Goods Receipt",
      number: gr.receiptNo, amount: Number(gr.grirTotal) || 0, balance: 0, currency: gr.currency || homeCcy,
      status: gr.status, memo: gr.notes, viewHref: null,
    });
  }

  rows.sort((a, b) => (a.txnDate < b.txnDate ? 1 : a.txnDate > b.txnDate ? -1 : 0));

  const counts: Record<string, number> = { total: rows.length };
  for (const t of ["Bill", "Expense", "Vendor Credit", "Bill Payment", "Purchase Order", "Goods Receipt"]) {
    counts[t] = rows.filter(r => r.type === t).length;
  }

  return ok({ rows, counts });
}
