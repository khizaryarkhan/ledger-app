/**
 * GET /api/accounting/dashboard?today=YYYY-MM-DD
 *
 * Rows 1–3 of the Accounting dashboard: what needs attention, the period,
 * cash by bank account, cash due in / out in the next 30 days, this month's
 * P&L against the same span of last month, and the top expense accounts.
 *
 * Every figure comes from an engine the reports already use
 * (`profitAndLoss`, `periodStatus`, the GL), so the dashboard cannot disagree
 * with them. Rules live in lib/accounting/dashboard.ts.
 */
import { NextRequest } from "next/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, apBills, pendingApprovals, organisations, goodsReceipts } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { isSyncedOrg } from "@/lib/accounting/account-roles-server";
import { profitAndLoss } from "@/lib/accounting/financials";
import { periodStatus } from "@/lib/accounting/period-close";
import { isWithinAsAt } from "@/lib/format";
import {
  monthToDateWindows, dueWithin, changePct, marginPct, topExpenses, isReconciliationStale, round2,
  type OpenItem,
} from "@/lib/accounting/dashboard";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown) => Number(v ?? 0);

async function rows<T>(query: any): Promise<T[]> {
  const res: any = await db.execute(query);
  return (res?.rows ?? res ?? []) as T[];
}

function openInvoiceBalance(inv: { qboBalance: number | null; xeroBalance: number | null; sageIntacctBalance: number | null; total: number; paid: number }): number {
  if (inv.qboBalance != null) return inv.qboBalance;
  if (inv.xeroBalance != null) return inv.xeroBalance;
  if (inv.sageIntacctBalance != null) return inv.sageIntacctBalance;
  return Math.max(0, num(inv.total) - num(inv.paid));
}

type Attention = { key: string; label: string; detail: string; href: string; count: number; amount?: number };

export async function GET(req: NextRequest) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const org = orgId!;

  // The viewer's own date: a server in UTC would put the month boundary a day
  // out either side of Greenwich. Anything malformed falls back to UTC today.
  const asked = req.nextUrl.searchParams.get("today") ?? "";
  const today = YMD.test(asked) ? asked : new Date().toISOString().slice(0, 10);
  const win = monthToDateWindows(today);

  const [orgRow] = await db.select({ currency: organisations.currency }).from(organisations).where(eq(organisations.id, org)).limit(1);
  const currency = orgRow?.currency ?? "EUR";
  const ledgerHeld = !(await isSyncedOrg(org));

  // ── Cash due in / out (receivables and payables, per currency) ──
  const invRows = await db.select({
    total: invoices.total, paid: invoices.paid, dueDate: invoices.dueDate, paymentStatus: invoices.paymentStatus,
    invoiceDate: invoices.invoiceDate, currency: invoices.currency,
    qboBalance: invoices.qboBalance, xeroBalance: invoices.xeroBalance, sageIntacctBalance: invoices.sageIntacctBalance,
  }).from(invoices).where(and(eq(invoices.orgId, org), isNull(invoices.deletedAt)));
  const arItems: OpenItem[] = invRows
    .filter((i) => i.paymentStatus !== "Written Off" && isWithinAsAt(i.invoiceDate, today))
    .map((i) => ({ currency: i.currency, balance: openInvoiceBalance(i), dueDate: i.dueDate }));

  const billRows = await db.select({ balance: apBills.balance, dueDate: apBills.dueDate, currency: apBills.currency })
    .from(apBills)
    .where(and(eq(apBills.orgId, org), inArray(apBills.accountingPaymentStatus, ["Unpaid", "Partially Paid"])));
  const apItems: OpenItem[] = billRows.map((b) => ({ currency: b.currency, balance: num(b.balance), dueDate: b.dueDate }));

  // ── Needs attention ──
  const attention: Attention[] = [];
  const pending = await db.select({ amount: pendingApprovals.amount })
    .from(pendingApprovals).where(and(eq(pendingApprovals.orgId, org), eq(pendingApprovals.status, "Pending")));
  if (pending.length) {
    attention.push({
      key: "approvals", label: "Awaiting approval", href: "/accounting/approvals", count: pending.length,
      amount: round2(pending.reduce((s, p) => s + num(p.amount), 0)),
      detail: `${pending.length} document${pending.length === 1 ? "" : "s"} waiting for a decision`,
    });
  }

  if (!ledgerHeld) {
    // Books kept in QuickBooks/Xero: nothing in our GL to show, so only the
    // rows that do not depend on it are returned.
    return ok({ today, currency, ledgerHeld, attention, period: null, banks: [], cashIn: dueWithin(arItems, today), cashOut: dueWithin(apItems, today), pl: null });
  }

  // Bank balances in the account's own currency (fx columns when the line was
  // entered in it, home otherwise) and the last statement each was reconciled to.
  const bankRows = await rows<{ id: string; name: string; code: string | null; currency: string | null; home: string; fx: string; last: string | null }>(sql`
    select a.id, a.name, a.code, a.currency,
           coalesce(sum(l.debit - l.credit), 0) as home,
           coalesce(sum(case when l.currency = a.currency then coalesce(l.fx_debit,0) - coalesce(l.fx_credit,0)
                             else l.debit - l.credit end), 0) as fx,
           (select max(r.statement_date)::text from bank_reconciliations r where r.org_id = a.org_id and r.account_id = a.id) as last
      from accounts a
      left join (journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'Posted')
             on l.account_id = a.id
     where a.org_id = ${org} and a.type = 'Bank' and a.is_header = false and a.active = true
     group by a.id, a.name, a.code, a.currency
     order by a.code nulls last, a.name`);
  const banks = bankRows.map((b) => {
    const ccy = b.currency || currency;
    return { accountId: b.id, name: b.name, code: b.code, currency: ccy, balance: round2(num(ccy === currency ? b.home : b.fx)), lastReconciled: b.last };
  });

  const stale = banks.filter((b) => isReconciliationStale(b.lastReconciled, today));
  if (stale.length) {
    attention.push({
      key: "reconcile", label: "Bank accounts to reconcile", href: "/accounting/reconcile", count: stale.length,
      detail: stale.length === 1 ? `${stale[0].name} not reconciled in the last 30 days` : `${stale.length} accounts not reconciled in the last 30 days`,
    });
  }

  const [susp] = await rows<{ bal: string }>(sql`
    select coalesce(sum(l.debit - l.credit), 0) as bal
      from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
     where l.org_id = ${org} and e.status = 'Posted' and lower(a.subtype) = 'suspense'`);
  const suspense = round2(num(susp?.bal));
  if (Math.abs(suspense) >= 0.01) {
    attention.push({
      key: "suspense", label: "Balance in Suspense", href: "/accounting/reports/general-ledger", count: 1, amount: suspense,
      detail: "Entries posted to Suspense need moving to the right account",
    });
  }

  const grn = await db.select({ grir: goodsReceipts.grirTotal, billed: goodsReceipts.billedAmount })
    .from(goodsReceipts).where(and(eq(goodsReceipts.orgId, org), eq(goodsReceipts.status, "Posted")));
  const unbilled = grn.filter((g) => num(g.grir) - num(g.billed) > 0.005);
  if (unbilled.length) {
    attention.push({
      key: "grni", label: "Goods received, not billed", href: "/supply-chain/receiving", count: unbilled.length,
      amount: round2(unbilled.reduce((s, g) => s + num(g.grir) - num(g.billed), 0)),
      detail: `${unbilled.length} receipt${unbilled.length === 1 ? "" : "s"} waiting for the supplier's bill`,
    });
  }

  const ps = await periodStatus(org);
  const lastClosed = ps.closes.find((c) => c.status !== "Reopened") ?? null;
  const period = { bookCloseDate: ps.bookCloseDate, lastClosedEnd: lastClosed?.periodEnd ?? null, fiscalYearStartLabel: ps.fiscalYearStartLabel };

  const [cur, prev] = await Promise.all([
    profitAndLoss([org], win.current.from, win.current.to),
    profitAndLoss([org], win.previous.from, win.previous.to),
  ]);
  const revenue = (p: typeof cur) => p.sections.find((s) => s.section === "Revenue")?.total ?? 0;
  const metric = (c: number, p: number) => ({ current: c, previous: p, change: changePct(c, p) });
  const expenseLines = [
    ...(cur.sections.find((s) => s.section === "Cost of Sales")?.lines ?? []),
    ...cur.operatingExpenses.lines,
    ...cur.financeCosts.lines,
  ];
  const pl = {
    window: win,
    revenue: metric(revenue(cur), revenue(prev)),
    grossProfit: metric(cur.grossProfit, prev.grossProfit),
    netProfit: metric(cur.netProfit, prev.netProfit),
    grossMargin: { current: marginPct(cur.grossProfit, revenue(cur)), previous: marginPct(prev.grossProfit, revenue(prev)) },
    topExpenses: topExpenses(expenseLines),
  };

  return ok({ today, currency, ledgerHeld, attention, period, banks, cashIn: dueWithin(arItems, today), cashOut: dueWithin(apItems, today), pl });
}
