/**
 * Customer-by-customer reconciliation against QBO.
 *
 * GET /api/qbo/reconcile-customers
 *
 * For every customer in the org that has a QBO id, calls QBO's Customer
 * endpoint live and returns Balance + BalanceWithJobs alongside our locally
 * computed balance. The page reading this can highlight any row where the
 * two don't match so the user knows exactly which customers' data has
 * drifted from QBO.
 *
 * Hits the QBO API once per customer. QBO production rate limit is 500/min;
 * we throttle to ~10/sec to stay well under it.
 */

import { db } from "@/db";
import {
  customers, invoices, payments, journalEntryArLines, deposits, paymentApplications,
} from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { getValidToken } from "@/lib/qbo-sync";
import { and, eq } from "drizzle-orm";

// Reconciliation iterates every customer with one QBO API call each. For an
// org with 200+ customers the default 10–60s serverless timeout kills the
// request and the UI sees no response. Bump to the Vercel Pro max.
export const maxDuration = 300;

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type RowOut = {
  customerId:        string;
  customerName:      string;
  customerCode:      string;
  qboId:             string | null;
  currency:          string;
  qboBalance:        number | null;        // Customer.Balance (parent only)
  qboBalanceWithJobs: number | null;       // Customer.BalanceWithJobs (incl. sub-customers)
  ourOpenInvoiceBalance: number;
  ourCmCredit:       number;
  ourPaymentCredit:  number;
  ourJeBalance:      number;
  ourDepositCredit:  number;
  ourNetBalance:     number;
  // Delta uses BalanceWithJobs because our local data aggregates the parent
  // customer with all its sub-customers (sub-customers are stored as projects
  // under the parent in our schema — see invoices.projectId). Comparing
  // against Balance alone would falsely flag every parent with sub-customer
  // AR as drifted.
  delta:             number | null;
  status:            "match" | "drift" | "no-qbo-id" | "qbo-error";
  error?:            string;
};

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const onlyDrifted = url.searchParams.get("driftOnly") === "true";
  const tolerance  = parseFloat(url.searchParams.get("tolerance") || "1.0");

  const token = await getValidToken(orgId!);
  if (!token) return bad("QBO not connected", 400);

  // Load every customer in the org along with all AR-affecting transactions
  // in one pass — cheaper than per-customer queries when reconciling many.
  const [allCusts, allInvs, allPmts, allJes, allDeps, allJeApps] = await Promise.all([
    db.select({
      id: customers.id, name: customers.name, code: customers.code,
      currency: customers.currency, qboId: customers.qboId,
    }).from(customers).where(eq(customers.orgId, orgId!)),
    db.select({
      customerId: invoices.customerId,
      total: invoices.total, paid: invoices.paid, qboBalance: invoices.qboBalance,
      paymentStatus: invoices.paymentStatus, collectionStage: invoices.collectionStage,
      txnType: invoices.txnType,
    }).from(invoices).where(eq(invoices.orgId, orgId!)),
    db.select({
      customerId: payments.customerId,
      unappliedAmount: payments.unappliedAmount,
    }).from(payments).where(eq(payments.orgId, orgId!)),
    db.select({
      customerId: journalEntryArLines.customerId,
      qboJournalId: journalEntryArLines.qboJournalId,
      amount: journalEntryArLines.amount,
      voided: journalEntryArLines.voided,
    }).from(journalEntryArLines).where(eq(journalEntryArLines.orgId, orgId!)),
    db.select({
      customerId: deposits.customerId,
      amount: deposits.amount,
    }).from(deposits).where(eq(deposits.orgId, orgId!)),
    db.select({
      targetQboId:   paymentApplications.targetQboId,
      amountApplied: paymentApplications.amountApplied,
    }).from(paymentApplications).where(and(
      eq(paymentApplications.orgId, orgId!),
      eq(paymentApplications.targetType, "JournalEntry"),
    )),
  ]);

  // Sum applied amount per JE qboJournalId so the per-customer balance pass
  // can net it against the JE's signed amount.
  const appliedByJeQboId = new Map<string, number>();
  for (const a of allJeApps) {
    if (!a.targetQboId) continue;
    appliedByJeQboId.set(a.targetQboId, (appliedByJeQboId.get(a.targetQboId) ?? 0) + (a.amountApplied ?? 0));
  }

  // Index by customerId for O(1) lookup during the per-customer pass.
  const invsByCust = new Map<string, typeof allInvs>();
  for (const inv of allInvs) {
    if (!inv.customerId) continue;
    if (!invsByCust.has(inv.customerId)) invsByCust.set(inv.customerId, []);
    invsByCust.get(inv.customerId)!.push(inv);
  }
  const pmtsByCust = new Map<string, typeof allPmts>();
  for (const p of allPmts) {
    if (!p.customerId) continue;
    if (!pmtsByCust.has(p.customerId)) pmtsByCust.set(p.customerId, []);
    pmtsByCust.get(p.customerId)!.push(p);
  }
  const jesByCust = new Map<string, typeof allJes>();
  for (const j of allJes) {
    if (!j.customerId) continue;
    if (!jesByCust.has(j.customerId)) jesByCust.set(j.customerId, []);
    jesByCust.get(j.customerId)!.push(j);
  }
  const depsByCust = new Map<string, typeof allDeps>();
  for (const d of allDeps) {
    if (!d.customerId) continue;
    if (!depsByCust.has(d.customerId)) depsByCust.set(d.customerId, []);
    depsByCust.get(d.customerId)!.push(d);
  }

  const rows: RowOut[] = [];
  let fetched = 0, errors = 0;

  for (const c of allCusts) {
    // Compute our local balance using the same logic as /api/customers/[id]/balance.
    let openInvoiceBalance = 0, cmCredit = 0;
    for (const inv of invsByCust.get(c.id) ?? []) {
      if (inv.txnType === "CreditMemo") {
        const bal = inv.qboBalance ?? 0;
        if (bal < -0.005) cmCredit += bal;
      } else {
        const closed = inv.paymentStatus === "Paid" || inv.collectionStage === "Closed";
        if (closed) continue;
        const remaining = inv.qboBalance ?? Math.max(0, (inv.total ?? 0) - (inv.paid ?? 0));
        if (remaining > 0.005) openInvoiceBalance += remaining;
      }
    }
    const paymentCredit = -(pmtsByCust.get(c.id) ?? []).reduce((s, p) => s + (p.unappliedAmount ?? 0), 0);

    // JE net open balance: signed amount with any applications subtracted
    // from its magnitude. A JE that QBO has fully applied via a zero-amount
    // payment will have an offsetting application captured during sync, so
    // it contributes zero here.
    const jeBalance = (jesByCust.get(c.id) ?? [])
      .filter(j => !j.voided)
      .reduce((s, j) => {
        const applied = appliedByJeQboId.get(j.qboJournalId) ?? 0;
        const openMagnitude = Math.max(0, Math.abs(j.amount ?? 0) - applied);
        return s + Math.sign(j.amount ?? 0) * openMagnitude;
      }, 0);

    const depositCredit =  (depsByCust.get(c.id) ?? []).reduce((s, d) => s + (d.amount ?? 0), 0);
    const ourNetBalance = openInvoiceBalance + cmCredit + paymentCredit + jeBalance + depositCredit;

    const base: Omit<RowOut, "qboBalance" | "qboBalanceWithJobs" | "delta" | "status"> = {
      customerId:        c.id,
      customerName:      c.name,
      customerCode:      c.code,
      qboId:             c.qboId,
      currency:          c.currency,
      ourOpenInvoiceBalance: openInvoiceBalance,
      ourCmCredit:       cmCredit,
      ourPaymentCredit:  paymentCredit,
      ourJeBalance:      jeBalance,
      ourDepositCredit:  depositCredit,
      ourNetBalance,
    };

    if (!c.qboId) {
      rows.push({ ...base, qboBalance: null, qboBalanceWithJobs: null, delta: null, status: "no-qbo-id" });
      continue;
    }

    // Fetch QBO Customer.Balance live. Throttle to ~10/sec.
    try {
      const res = await fetch(
        `${QBO_API}/${token.realmId}/customer/${c.qboId}?minorversion=65`,
        { headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" } },
      );
      if (!res.ok) {
        errors++;
        rows.push({
          ...base, qboBalance: null, qboBalanceWithJobs: null, delta: null,
          status: "qbo-error", error: `HTTP ${res.status}`,
        });
      } else {
        const data = await res.json();
        const q = data.Customer || data;
        const qboBalance         = parseFloat(q.Balance)         || 0;
        const qboBalanceWithJobs = parseFloat(q.BalanceWithJobs) || qboBalance;
        // Compare against BalanceWithJobs — our customer record aggregates
        // its sub-customer (project) AR under the parent customerId.
        const delta = ourNetBalance - qboBalanceWithJobs;
        const status: RowOut["status"] = Math.abs(delta) < tolerance ? "match" : "drift";
        rows.push({ ...base, qboBalance, qboBalanceWithJobs, delta, status });
        fetched++;
      }
    } catch (e: any) {
      errors++;
      rows.push({
        ...base, qboBalance: null, qboBalanceWithJobs: null, delta: null,
        status: "qbo-error", error: e?.message || String(e),
      });
    }

    // Light throttle so we don't exhaust QBO's 500/min rate limit on large
    // orgs. 30ms = ~33 req/sec which leaves plenty of headroom.
    await sleep(30);
  }

  const filtered = onlyDrifted ? rows.filter(r => r.status === "drift") : rows;
  const totals = {
    customersChecked: allCusts.length,
    qboFetched:       fetched,
    qboErrors:        errors,
    customersInDrift: rows.filter(r => r.status === "drift").length,
    customersInMatch: rows.filter(r => r.status === "match").length,
    customersWithoutQboId: rows.filter(r => r.status === "no-qbo-id").length,
    ourTotalNetAR:    rows.reduce((s, r) => s + r.ourNetBalance, 0),
    qboTotalNetAR:    rows.reduce((s, r) => s + (r.qboBalanceWithJobs ?? r.qboBalance ?? 0), 0),
  };

  return ok({
    asOf: new Date().toISOString(),
    tolerance,
    rows: filtered.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0)),
    totals,
  });
}
