/**
 * Customer Statement of Account.
 *
 * GET /api/reports/statement?customerId=<uuid>&asOf=YYYY-MM-DD[&from=YYYY-MM-DD]
 *
 * Builds a self-contained statement of account from our synced data:
 *   - Opening balance (as of `from` or earliest activity if not supplied)
 *   - Every transaction in the period with a running balance
 *   - Closing balance as of `asOf`
 *   - Aging breakdown of the closing balance
 *
 * Transactions included (all AR-affecting types we sync):
 *   - Invoices
 *   - Credit Memos
 *   - Payments + their applications
 *   - Refund Receipts
 *   - Journal Entry AR lines (NET of payment applications)
 *   - Deposit AR lines
 *
 * No QBO dependency — pure ledger query.
 */

import { db } from "@/db";
import {
  customers, invoices, payments, paymentApplications, journalEntryArLines,
  deposits, refundReceipts,
} from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, lte, gte } from "drizzle-orm";

type Row = {
  date: string;
  type: "Invoice" | "Credit Memo" | "Payment" | "Refund Receipt" | "Journal Entry" | "Deposit";
  number: string | null;
  description: string | null;
  debit: number;     // increases AR
  credit: number;    // decreases AR
  amount: number;    // signed (debit - credit)
  runningBalance: number;
  refId: string;     // for deep-link in UI
};

type AgingBuckets = { Current: number; "1-30": number; "31-60": number; "61-90": number; "91+": number };

function emptyBuckets(): AgingBuckets {
  return { Current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "91+": 0 };
}

function daysBetween(later: string, earlier: string): number {
  const a = new Date(later  + "T00:00:00Z").getTime();
  const b = new Date(earlier + "T00:00:00Z").getTime();
  return Math.floor((a - b) / 86400000);
}

function bucketize(daysPastDue: number, buckets: AgingBuckets, amount: number) {
  if (daysPastDue <= 0)  buckets.Current += amount;
  else if (daysPastDue <= 30) buckets["1-30"]  += amount;
  else if (daysPastDue <= 60) buckets["31-60"] += amount;
  else if (daysPastDue <= 90) buckets["61-90"] += amount;
  else                         buckets["91+"]   += amount;
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const customerId = url.searchParams.get("customerId");
  const asOf       = url.searchParams.get("asOf") || new Date().toISOString().slice(0, 10);
  const from       = url.searchParams.get("from"); // optional — when omitted, "all time" is used

  if (!customerId) return bad("customerId required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return bad("asOf must be YYYY-MM-DD");
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return bad("from must be YYYY-MM-DD");

  // 1. Load customer
  const [cust] = await db.select({
    id: customers.id, name: customers.name, code: customers.code,
    email: customers.email, phone: customers.phone, currency: customers.currency,
    paymentTerms: customers.paymentTerms,
    addressStreet: customers.addressStreet, addressCity: customers.addressCity,
    addressPostcode: customers.addressPostcode, country: customers.country,
  }).from(customers).where(and(eq(customers.id, customerId), eq(customers.orgId, orgId!))).limit(1);
  if (!cust) return bad("Customer not found", 404);

  // 2. Load every AR-affecting event for this customer up to asOf
  const [invs, pmts, apps, jes, deps, refs] = await Promise.all([
    db.select().from(invoices).where(and(
      eq(invoices.orgId, orgId!),
      eq(invoices.customerId, customerId),
      lte(invoices.invoiceDate, asOf),
    )),
    db.select().from(payments).where(and(
      eq(payments.orgId, orgId!),
      eq(payments.customerId, customerId),
      lte(payments.txnDate, asOf),
    )),
    db.select().from(paymentApplications).where(eq(paymentApplications.orgId, orgId!)),
    db.select().from(journalEntryArLines).where(and(
      eq(journalEntryArLines.orgId, orgId!),
      eq(journalEntryArLines.customerId, customerId),
      lte(journalEntryArLines.txnDate, asOf),
    )),
    db.select().from(deposits).where(and(
      eq(deposits.orgId, orgId!),
      eq(deposits.customerId, customerId),
      lte(deposits.txnDate, asOf),
    )),
    db.select().from(refundReceipts).where(and(
      eq(refundReceipts.orgId, orgId!),
      eq(refundReceipts.customerId, customerId),
      lte(refundReceipts.txnDate, asOf),
    )),
  ]);

  // Build per-JE applied totals for line-level netting
  const appliedByJeLine   = new Map<string, number>();
  const appliedByJeHeader = new Map<string, number>();
  const validPmtIds = new Set(pmts.map(p => p.id));
  for (const a of apps) {
    if (a.targetType !== "JournalEntry") continue;
    if (!validPmtIds.has(a.paymentId)) continue;
    if (!a.targetQboId) continue;
    if (a.targetLineId) {
      const k = `${a.targetQboId}|${a.targetLineId}`;
      appliedByJeLine.set(k, (appliedByJeLine.get(k) ?? 0) + (a.amountApplied ?? 0));
    } else {
      appliedByJeHeader.set(a.targetQboId, (appliedByJeHeader.get(a.targetQboId) ?? 0) + (a.amountApplied ?? 0));
    }
  }
  // Distribute header-level apps across each JE's lines proportionally
  const headerAllocByJeId = new Map<string, number>();
  if (appliedByJeHeader.size > 0) {
    const byHeader = new Map<string, { id: string; abs: number }[]>();
    for (const je of jes) {
      if ((je as any).voided) continue;
      const abs = Math.abs(je.amount ?? 0);
      if (abs < 0.005) continue;
      const list = byHeader.get(je.qboJournalId) ?? [];
      list.push({ id: je.id, abs });
      byHeader.set(je.qboJournalId, list);
    }
    for (const [hdr, total] of appliedByJeHeader.entries()) {
      const list = byHeader.get(hdr);
      if (!list?.length) continue;
      const sum = list.reduce((s, l) => s + l.abs, 0);
      if (sum < 0.005) continue;
      let rem = total;
      for (let i = 0; i < list.length; i++) {
        const share = i === list.length - 1 ? rem : (list[i].abs / sum) * total;
        headerAllocByJe(headerAllocByJeId).set(list[i].id, share);
        rem -= share;
      }
    }
  }
  function headerAllocByJe(m: Map<string, number>) { return m; }

  // 3. Assemble a chronological row list
  const rows: Row[] = [];

  // Invoices and Credit Memos
  for (const inv of invs) {
    const isCm = inv.txnType === "CreditMemo";
    rows.push({
      date: inv.invoiceDate,
      type: isCm ? "Credit Memo" : "Invoice",
      number: inv.invoiceNumber,
      description: inv.notes || null,
      debit:  isCm ? 0 : Math.max(0,  inv.total),
      credit: isCm ? Math.abs(inv.total) : 0,
      amount: inv.total,
      runningBalance: 0, // filled in after sorting
      refId: inv.id,
    });
  }

  // Payments — debit/credit is reversed (payments REDUCE AR)
  for (const p of pmts) {
    rows.push({
      date: p.txnDate,
      type: "Payment",
      number: p.paymentRef,
      description: p.privateNote || (p.paymentMethod ? `${p.paymentMethod}` : null),
      debit: 0,
      credit: p.totalAmount,
      amount: -p.totalAmount,
      runningBalance: 0,
      refId: p.id,
    });
  }

  // Refund Receipts — debit (paid back to customer, increases their AR)
  for (const r of refs) {
    rows.push({
      date: r.txnDate,
      type: "Refund Receipt",
      number: null,
      description: r.privateNote || null,
      debit: r.totalAmount,
      credit: 0,
      amount: r.totalAmount,
      runningBalance: 0,
      refId: r.id,
    });
  }

  // Journal Entry AR lines — signed (per-line netting respected later)
  for (const je of jes) {
    if ((je as any).voided) continue;
    let applied = 0;
    if (je.qboLineId) applied = appliedByJeLine.get(`${je.qboJournalId}|${je.qboLineId}`) ?? 0;
    if (applied === 0) applied = headerAllocByJeId.get(je.id) ?? 0;
    const openMagnitude = Math.max(0, Math.abs(je.amount ?? 0) - applied);
    const openSigned = Math.sign(je.amount ?? 0) * openMagnitude;
    if (Math.abs(openSigned) < 0.005) continue;
    rows.push({
      date: je.txnDate,
      type: "Journal Entry",
      number: je.docNumber,
      description: je.accountName || null,
      debit:  openSigned > 0 ?  openSigned : 0,
      credit: openSigned < 0 ? -openSigned : 0,
      amount: openSigned,
      runningBalance: 0,
      refId: je.id,
    });
  }

  // Deposits — signed (typically negative = customer credit)
  for (const d of deps) {
    rows.push({
      date: d.txnDate,
      type: "Deposit",
      number: d.qboId,
      description: d.description || d.accountName || null,
      debit:  d.amount > 0 ?  d.amount : 0,
      credit: d.amount < 0 ? -d.amount : 0,
      amount: d.amount,
      runningBalance: 0,
      refId: d.id,
    });
  }

  // 4. Sort chronologically, compute opening + closing + running balance
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    // Stable order: invoices first, then payments, then everything else
    const order: Record<Row["type"], number> = {
      "Invoice": 0, "Credit Memo": 1, "Journal Entry": 2,
      "Deposit": 3, "Payment": 4, "Refund Receipt": 5,
    };
    return order[a.type] - order[b.type];
  });

  let openingBalance = 0;
  let runningBalance = 0;
  const inPeriod: Row[] = [];
  for (const r of rows) {
    if (from && r.date < from) {
      // Pre-period: contributes to opening balance only
      openingBalance += r.amount;
      continue;
    }
    runningBalance = (inPeriod.length === 0 ? openingBalance : inPeriod[inPeriod.length - 1].runningBalance) + r.amount;
    inPeriod.push({ ...r, runningBalance });
  }
  const closingBalance = inPeriod.length > 0 ? inPeriod[inPeriod.length - 1].runningBalance : openingBalance;

  // 5. Aging breakdown of the closing balance — open invoices only,
  //    plus credits as a separate aggregate.
  const ageingBuckets = emptyBuckets();
  let creditsTotal = 0;
  for (const inv of invs) {
    if (inv.txnType === "CreditMemo") continue;
    const closed = inv.paymentStatus === "Paid" || inv.collectionStage === "Closed";
    if (closed) continue;
    const remaining = inv.qboBalance ?? Math.max(0, (inv.total ?? 0) - (inv.paid ?? 0));
    if (remaining < 0.005) continue;
    const due = inv.dueDate || inv.invoiceDate;
    bucketize(daysBetween(asOf, due), ageingBuckets, remaining);
  }
  // Unapplied CMs + JE credits + deposit credits
  for (const inv of invs) {
    if (inv.txnType !== "CreditMemo") continue;
    const bal = inv.qboBalance ?? 0;
    if (bal < -0.005) creditsTotal += bal;
  }
  creditsTotal += (rows.filter(r => r.type === "Deposit" && r.amount < 0).reduce((s, r) => s + r.amount, 0));
  // Note: JE credits are included in the closingBalance; the bucket breakdown
  // above does not include them — they sit in `creditsTotal` for clarity.

  return ok({
    customer: cust,
    period: { from: from ?? "all-time", asOf },
    openingBalance,
    closingBalance,
    rows: inPeriod,
    summary: {
      totalDebits:  inPeriod.reduce((s, r) => s + r.debit, 0),
      totalCredits: inPeriod.reduce((s, r) => s + r.credit, 0),
      txnCount:     inPeriod.length,
    },
    aging: {
      buckets: ageingBuckets,
      openInvoicesTotal:
        ageingBuckets.Current + ageingBuckets["1-30"] + ageingBuckets["31-60"] +
        ageingBuckets["61-90"] + ageingBuckets["91+"],
      creditsTotal,
    },
  });
}
