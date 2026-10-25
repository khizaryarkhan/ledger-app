/**
 * Assembles everything a printable business document needs, in one shape, for
 * both ledger documents (Invoice/Bill/…) and trade documents (Quote/PO/SO).
 *
 * Why this exists: the print pages used to reverse-engineer a document from its
 * JOURNAL LINES, which carry only an account and an amount. That is why printed
 * invoices had no quantity, no unit price and no tax breakdown — the data was
 * never in the rows being read. Line-item documents store the original form
 * input in `journal_entries.source_payload`, which does have qty/rate/tax, so
 * that is the source of truth here, with the journal lines as a fallback for
 * older entries posted before payloads were stored.
 */

import { db } from "@/db";
import {
  organisations, journalEntries, journalLines, accounts, apTaxRates, apItems,
  customers, apSuppliers, tradeDocuments, tradeDocumentLines, apBills, apBillLines,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { linksFor } from "@/lib/accounting/links";
import { amountInWords } from "@/lib/accounting/amount-in-words";

const num = (v: any) => Number(v ?? 0);
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type PrintParty = {
  name: string | null; addressLines: string[]; taxNumber: string | null;
  email: string | null; phone: string | null;
};
export type PrintLine = {
  name: string | null; description: string | null;
  qty: number | null; uom: string | null; rate: number | null;
  taxLabel: string | null; taxPct: number | null; amount: number;
};
export type PrintVoucherLine = { account: string; name: string | null; description: string | null; debit: number; credit: number };
export type PrintDocument = {
  company: any;
  doc: {
    kind: string; label: string; docNumber: string | null; status: string | null;
    date: string; dueDate: string | null; dueLabel: string;
    reference: string | null; memo: string | null; currency: string;
    partyHeading: string; isPurchase: boolean;
    /** Payment terms in days, when the counterparty has them set. */
    termsDays?: number | null;
    /** Whether this document type is signed off before it's acted on. */
    needsSignature?: boolean;
    /** Overrides the accent total box's label ("Balance due"/"Total due") —
     *  e.g. "Amount received" for a Payment, which has no balance of its own. */
    totalLabel?: string | null;
    /** Transfer / Manual Journal Entry — no party, no "goods and services"
     *  concept, just a debit/credit table. When set, PrintSheetBody renders
     *  `voucherLines` instead of the item-lines + party-box + balance-due
     *  layout every other document type uses. */
    isVoucher?: boolean;
  };
  party: PrintParty;
  lines: PrintLine[];
  voucherLines?: PrintVoucherLine[];
  totals: {
    subtotal: number; taxes: { label: string; amount: number }[]; taxTotal: number;
    total: number; paid: number; balance: number; inWords: string;
  };
};

/** Label + party heading + due-date wording per document type. */
const DOC_META: Record<string, { label: string; party: string; due: string; purchase?: boolean; totalLabel?: string }> = {
  Invoice:       { label: "INVOICE",         party: "Bill to",  due: "Due" },
  SalesReceipt:  { label: "SALES RECEIPT",   party: "Received from", due: "Due" },
  CreditNote:    { label: "CREDIT NOTE",     party: "Credit to", due: "Due" },
  RefundReceipt: { label: "REFUND RECEIPT",  party: "Refunded to", due: "Due" },
  Bill:          { label: "BILL",            party: "From",     due: "Due", purchase: true },
  Expense:       { label: "EXPENSE",         party: "Paid to",  due: "Due", purchase: true },
  VendorCredit:  { label: "SUPPLIER CREDIT", party: "From",     due: "Due", purchase: true },
  Estimate:      { label: "QUOTE",           party: "For",      due: "Valid until" },
  PurchaseOrder: { label: "PURCHASE ORDER",  party: "Supplier", due: "Deliver by", purchase: true },
  SalesOrder:    { label: "SALES ORDER",     party: "Customer", due: "Required by" },
  Payment:       { label: "PAYMENT RECEIPT", party: "Received from", due: "Date", totalLabel: "Amount received" },
  BillPayment:   { label: "PAYMENT",         party: "Paid to",  due: "Date", purchase: true, totalLabel: "Amount paid" },
  Deposit:       { label: "DEPOSIT",         party: "Deposited by", due: "Date" },
  Manual:        { label: "JOURNAL ENTRY",   party: "",         due: "Date" },
  Transfer:      { label: "TRANSFER",        party: "",         due: "Date" },
};

/** Transfer / Manual Journal Entry — debit/credit-shaped, no party and no
 *  "goods and services" concept. Printed as a voucher (Account/Name/
 *  Description/Debit/Credit table) instead of being forced through the
 *  invoice-shaped item-lines template. */
const VOUCHER_TYPES = new Set(["Manual", "Transfer"]);

/** Payment / BillPayment settle OTHER documents — they have no "goods and
 *  services" lines of their own, so printing them as what they actually are
 *  (a receipt/remittance) means one row per document they were applied to,
 *  not the journal-line fallback below (which would show Dr Bank / Cr A-R/A-P
 *  — both of which that fallback's own account-type exclusion filters out,
 *  producing a blank, $0.00 "receipt"). */
const SETTLEMENT_TYPES = new Set(["Payment", "BillPayment"]);

export async function loadCompany(orgId: string) {
  const [o] = await db.select().from(organisations).where(eq(organisations.id, orgId)).limit(1);
  if (!o) return null;
  const addressLines = [
    o.addressStreet, o.addressLine2,
    [o.addressCity, o.addressState, o.addressPostcode].filter(Boolean).join(", ") || null,
    o.addressCountry,
  ].filter(Boolean) as string[];
  return {
    name: o.displayName || o.name, logoUrl: o.logoUrl, addressLines,
    phone: o.phone, email: o.email, website: o.website,
    taxNumber: o.taxNumber, registrationNumber: o.registrationNumber,
    bank: {
      name: o.bankName, accountName: o.bankAccountName, accountNumber: o.bankAccountNumber,
      iban: o.bankIban, swift: o.bankSwift, branch: o.bankBranch,
    },
    terms: o.documentTerms, footer: o.documentFooter,
    accent: o.documentAccentColor || "#1F3A5F", // professional navy default
    currency: o.currency,
  };
}

async function loadParty(orgId: string, partyType: string | null | undefined, partyId: string | null | undefined, fallbackLabel: string | null): Promise<PrintParty> {
  const empty: PrintParty = { name: fallbackLabel, addressLines: [], taxNumber: null, email: null, phone: null };
  if (!partyId) return empty;

  if (partyType === "Vendor") {
    const [s] = await db.select().from(apSuppliers)
      .where(and(eq(apSuppliers.id, partyId), eq(apSuppliers.orgId, orgId))).limit(1);
    if (!s) return empty;
    return {
      name: s.name ?? fallbackLabel,
      addressLines: [s.addressStreet, s.addressLine2,
        [s.addressCity, s.addressState, s.addressPostcode].filter(Boolean).join(", ") || null,
        s.country].filter(Boolean) as string[],
      taxNumber: s.taxNumber ?? null, email: s.email ?? null, phone: s.phone ?? null,
    };
  }

  const [c] = await db.select().from(customers)
    .where(and(eq(customers.id, partyId), eq(customers.orgId, orgId))).limit(1);
  if (!c) return empty;
  return {
    name: c.name ?? fallbackLabel,
    addressLines: [c.addressStreet, c.addressLine2,
      [c.addressCity, c.addressState, c.addressPostcode].filter(Boolean).join(", ") || null,
      c.country].filter(Boolean) as string[],
    taxNumber: c.taxNumber ?? null, email: c.email ?? null, phone: c.phone ?? null,
  };
}

/** Resolve item names + tax percentages for a set of payload lines. */
async function decorateLines(orgId: string, rawLines: any[]): Promise<PrintLine[]> {
  const itemIds = [...new Set(rawLines.map(l => l.itemId).filter(Boolean))] as string[];
  const taxIds = [...new Set(rawLines.map(l => l.taxRateId).filter(Boolean))] as string[];
  const [items, taxes] = await Promise.all([
    itemIds.length ? db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom })
      .from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, itemIds))) : Promise.resolve([]),
    taxIds.length ? db.select({ id: apTaxRates.id, name: apTaxRates.name, rate: apTaxRates.rate })
      .from(apTaxRates).where(and(eq(apTaxRates.orgId, orgId), inArray(apTaxRates.id, taxIds))) : Promise.resolve([]),
  ]);
  const itemById = new Map(items.map(i => [i.id, i]));
  const taxById = new Map(taxes.map(t => [t.id, t]));

  return rawLines.map(l => {
    const it = l.itemId ? itemById.get(l.itemId) : null;
    const tx = l.taxRateId ? taxById.get(l.taxRateId) : null;
    return {
      name: it?.name ?? null,
      description: l.description ?? null,
      qty: l.qty != null && l.qty !== "" ? num(l.qty) : null,
      uom: l.orderUom || it?.baseUom || null,
      rate: l.rate != null && l.rate !== "" ? num(l.rate) : null,
      taxLabel: tx?.name ?? null,
      taxPct: tx ? num(tx.rate) : null,
      amount: round2(num(l.amount)),
    };
  });
}

/** Group per-line tax into one row per rate, the way a tax authority expects. */
function taxBreakdown(lines: PrintLine[]): { label: string; amount: number }[] {
  const byLabel = new Map<string, number>();
  for (const l of lines) {
    if (!l.taxPct) continue;
    const label = l.taxLabel ? `${l.taxLabel} (${l.taxPct}%)` : `Tax (${l.taxPct}%)`;
    byLabel.set(label, round2((byLabel.get(label) ?? 0) + round2(l.amount * l.taxPct / 100)));
  }
  return [...byLabel.entries()].map(([label, amount]) => ({ label, amount }));
}

/** A posted ledger document (Invoice, Bill, Credit note, …). */
export async function loadLedgerDocumentForPrint(orgId: string, entryId: string): Promise<PrintDocument | null> {
  const [entry] = await db.select().from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId))).limit(1);
  if (!entry) return null;

  const company = await loadCompany(orgId);
  const meta = DOC_META[entry.sourceType] ?? { label: (entry.sourceType || "DOCUMENT").toUpperCase(), party: "Party", due: "Due" };
  const payload = (entry.sourcePayload as any) ?? null;

  if (VOUCHER_TYPES.has(entry.sourceType)) {
    const rows = await db.select({
      accountName: accounts.name, accountCode: accounts.code,
      nameLabel: journalLines.nameLabel, description: journalLines.description,
      debit: journalLines.debit, credit: journalLines.credit,
    }).from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entryId)))
      .orderBy(journalLines.lineNo);
    const voucherLines: PrintVoucherLine[] = rows.map(r => ({
      account: r.accountCode ? `${r.accountCode} · ${r.accountName}` : r.accountName,
      name: r.nameLabel ?? null, description: r.description ?? null,
      debit: round2(num(r.debit)), credit: round2(num(r.credit)),
    }));
    const total = round2(voucherLines.reduce((s, l) => s + l.debit, 0));
    const currency = company?.currency || "";
    return {
      company,
      doc: {
        kind: entry.sourceType, label: meta.label, docNumber: entry.docNumber, status: entry.status,
        date: entry.entryDate, dueDate: null, dueLabel: meta.due,
        reference: entry.reference ?? null, memo: entry.memo ?? null, currency,
        partyHeading: "", isPurchase: false, isVoucher: true,
      },
      party: { name: null, addressLines: [], taxNumber: null, email: null, phone: null },
      lines: [], voucherLines,
      totals: { subtotal: total, taxes: [], taxTotal: 0, total, paid: 0, balance: 0, inWords: amountInWords(total, currency) },
    };
  }

  const links = await linksFor(orgId, entry.sourceType, entry.id).catch(() => [] as any[]);
  const isSettlement = SETTLEMENT_TYPES.has(entry.sourceType);

  let lines: PrintLine[];
  let paid = 0;
  if (isSettlement) {
    // `links` here IS what this Payment/BillPayment was applied to — one row
    // per invoice/bill it settled, at the amount actually applied (its own
    // "lines"), not a count of what's been paid against the payment itself
    // (a payment document has no balance of its own to pay down).
    const applied: PrintLine[] = links
      .filter((l: any) => l.relation === "payment" || l.relation === "credit")
      .map((l: any) => ({
        name: null, description: `${l.docNumber ? `${l.type} ${l.docNumber}` : l.type}`.trim(),
        qty: null, uom: null, rate: null, taxLabel: null, taxPct: null, amount: round2(num(l.linkedAmount)),
      }));
    const gross = round2(num(payload?.amount));
    const appliedTotal = round2(applied.reduce((s, l) => s + l.amount, 0));
    const unapplied = round2(gross - appliedTotal);
    if (unapplied > 0.005 || applied.length === 0) {
      applied.push({ name: null, description: "Unapplied (on account)", qty: null, uom: null, rate: null, taxLabel: null, taxPct: null, amount: unapplied > 0 ? unapplied : gross });
    }
    lines = applied;
  } else if (payload?.lines?.length) {
    lines = await decorateLines(orgId, payload.lines.filter((l: any) => num(l.amount) !== 0));
  } else {
    // Pre-payload entries: fall back to the journal lines, excluding the
    // control/tax/bank postings so only the goods-and-services rows show.
    const rows = await db.select({
      description: journalLines.description, debit: journalLines.debit, credit: journalLines.credit,
      type: accounts.type, subtype: accounts.subtype, accountName: accounts.name,
    }).from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entryId)))
      .orderBy(journalLines.lineNo);
    lines = rows
      .filter(r => r.type !== "Accounts Receivable" && r.type !== "Accounts Payable"
        && r.subtype !== "SalesTaxPayable" && r.type !== "Bank" && r.type !== "Credit Card")
      .map(r => ({
        name: null, description: r.description || r.accountName,
        qty: null, uom: null, rate: null, taxLabel: null, taxPct: null,
        amount: round2(num(r.debit) || num(r.credit)),
      }));
  }

  const party = await loadParty(orgId, payload?.partyType, payload?.partyId,
    (await firstNameLabel(orgId, entryId)) ?? payload?.partyLabel ?? null);

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const taxes = taxBreakdown(lines);
  const taxTotal = round2(taxes.reduce((s, t) => s + t.amount, 0));
  const total = round2(subtotal + taxTotal);

  // What's been settled against this document so far (payments, credits) —
  // meaningless for a settlement document itself (paid stays 0 above).
  if (!isSettlement) paid = round2((links ?? []).reduce((s: number, l: any) => s + num(l.linkedAmount), 0));
  const currency = payload?.currency || company?.currency || "";

  return {
    company,
    doc: {
      kind: entry.sourceType, label: meta.label, docNumber: entry.docNumber, status: entry.status,
      date: entry.entryDate, dueDate: entry.dueDate ?? null, dueLabel: meta.due,
      reference: entry.reference ?? null, memo: entry.memo ?? null, currency,
      partyHeading: meta.party, isPurchase: !!meta.purchase, totalLabel: meta.totalLabel ?? null,
    },
    party, lines,
    totals: {
      subtotal, taxes, taxTotal, total,
      paid, balance: round2(total - paid),
      inWords: amountInWords(total, currency),
    },
  };
}

/** The counterparty name recorded on the entry's control line. */
async function firstNameLabel(orgId: string, entryId: string): Promise<string | null> {
  const rows = await db.select({ nameLabel: journalLines.nameLabel })
    .from(journalLines)
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entryId)));
  return rows.find(r => r.nameLabel)?.nameLabel ?? null;
}

/** A trade document (Quote / Purchase Order / Sales Order). */
export async function loadTradeDocumentForPrint(orgId: string, id: string): Promise<PrintDocument | null> {
  const [doc] = await db.select().from(tradeDocuments)
    .where(and(eq(tradeDocuments.id, id), eq(tradeDocuments.orgId, orgId))).limit(1);
  if (!doc) return null;

  const company = await loadCompany(orgId);
  const meta = DOC_META[doc.kind] ?? { label: doc.kind.toUpperCase(), party: "Party", due: "Valid until" };

  const rawLines = await db.select().from(tradeDocumentLines)
    .where(and(eq(tradeDocumentLines.documentId, id), eq(tradeDocumentLines.orgId, orgId)))
    .orderBy(tradeDocumentLines.lineNo);
  const lines = await decorateLines(orgId, rawLines);
  const party = await loadParty(orgId, doc.partyType, doc.partyId, doc.partyLabel);

  const subtotal = round2(num(doc.subtotal)) || round2(lines.reduce((s, l) => s + l.amount, 0));
  const taxes = taxBreakdown(lines);
  const taxTotal = round2(num(doc.taxTotal)) || round2(taxes.reduce((s, t) => s + t.amount, 0));
  const total = round2(num(doc.total)) || round2(subtotal + taxTotal);
  const currency = doc.currency || company?.currency || "";

  return {
    company,
    doc: {
      kind: doc.kind, label: meta.label, docNumber: doc.docNumber, status: doc.status,
      date: doc.issueDate, dueDate: doc.expiryDate ?? null, dueLabel: meta.due,
      reference: null, memo: doc.memo ?? null, currency,
      partyHeading: meta.party, isPurchase: !!meta.purchase,
      needsSignature: doc.kind === "PurchaseOrder" || doc.kind === "Estimate",
    },
    party, lines,
    totals: {
      subtotal, taxes, taxTotal, total,
      paid: 0, balance: total,
      inWords: amountInWords(total, currency),
    },
  };
}

/**
 * A QBO/Xero/Sage-mirrored bill that was never posted to our own GL —
 * `apBills.entryId` is null for these by design (see that column's own
 * schema comment: posting a provider-mirrored bill ourselves would
 * double-count against the provider's own ledger). loadLedgerDocumentForPrint
 * can't render these at all, since there is no journal_entries row to read.
 * This builds the same PrintDocument shape straight from the ap_bills/
 * ap_bill_lines snapshot instead, so it still goes through the one shared
 * template/engine rather than a second rendering path.
 */
export async function loadBillForPrint(orgId: string, billId: string): Promise<PrintDocument | null> {
  const [bill] = await db.select().from(apBills)
    .where(and(eq(apBills.id, billId), eq(apBills.orgId, orgId))).limit(1);
  if (!bill) return null;

  const company = await loadCompany(orgId);
  const rawLines = await db.select().from(apBillLines)
    .where(eq(apBillLines.billId, billId))
    .orderBy(apBillLines.lineNumber);

  // ap_bill_lines.itemId/accountId/taxRateId are the PROVIDER's own raw ids
  // (QBO ItemRef.value / Xero ItemCode) — never apItems.id/apTaxRates.id — so
  // these rows carry their own denormalised name/amount columns rather than
  // being joined, unlike decorateLines() for native documents.
  const lines: PrintLine[] = rawLines.map(l => {
    const subtotal = num(l.lineSubtotal);
    const tax = num(l.lineTax);
    return {
      name: l.itemName ?? null,
      description: l.description ?? l.accountName ?? null,
      qty: l.quantity != null ? num(l.quantity) : null,
      uom: null,
      rate: l.unitPrice != null ? num(l.unitPrice) : null,
      taxLabel: tax ? "Tax" : null,
      taxPct: tax && subtotal ? round2((tax / subtotal) * 100) : null,
      amount: round2(num(l.lineTotal)),
    };
  });

  let party: PrintParty = { name: null, addressLines: [], taxNumber: null, email: null, phone: null };
  if (bill.supplierId) {
    const [s] = await db.select().from(apSuppliers)
      .where(and(eq(apSuppliers.id, bill.supplierId), eq(apSuppliers.orgId, orgId))).limit(1);
    if (s) {
      party = {
        name: s.name ?? null,
        addressLines: [s.addressStreet, s.addressLine2,
          [s.addressCity, s.addressState, s.addressPostcode].filter(Boolean).join(", ") || null,
          s.country].filter(Boolean) as string[],
        taxNumber: s.taxNumber ?? null, email: s.email ?? null, phone: s.phone ?? null,
      };
    }
  }

  const taxes = taxBreakdown(lines);
  const subtotal = round2(num(bill.subtotal)) || round2(lines.reduce((s, l) => s + l.amount, 0));
  const taxTotal = round2(num(bill.taxTotal)) || round2(taxes.reduce((s, t) => s + t.amount, 0));
  const total = round2(num(bill.total)) || round2(subtotal + taxTotal);
  const currency = bill.currency || company?.currency || "";

  return {
    company,
    doc: {
      kind: "Bill", label: "BILL", docNumber: bill.billNumber ?? null, status: bill.accountingPaymentStatus,
      date: bill.billDate ?? "", dueDate: bill.dueDate ?? null, dueLabel: "Due",
      reference: bill.reference ?? null, memo: null, currency,
      partyHeading: "From", isPurchase: true,
    },
    party, lines,
    totals: {
      subtotal, taxes, taxTotal, total,
      paid: round2(num(bill.amountPaid)), balance: round2(num(bill.balance)),
      inWords: amountInWords(total, currency),
    },
  };
}
