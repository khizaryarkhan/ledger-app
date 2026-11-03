/**
 * GET /api/reports/executive-overview
 *
 * A single, whole-business snapshot for a non-bookkeeper reader (owner/CEO):
 * cash, receivables, payables, inventory value, revenue/margin (MTD + YTD),
 * and everything currently awaiting someone's approval. Built entirely from
 * this org's own data (native GL via lib/accounting/financials.ts + the
 * synced invoices/bills tables) — no QBO/Xero report call, so it works
 * whether or not an integration is connected, and always reconciles to the
 * same ledger the other native reports use.
 */

import { db } from "@/db";
import { invoices, apBills, apItems, pendingApprovals, organisations } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { totalsByCurrency, headlineTotal, type OpenItem } from "@/lib/ar-currency";
import { isSyncedOrg } from "@/lib/accounting/account-roles-server";
import { profitAndLoss, trialBalance, balanceSheet } from "@/lib/accounting/financials";
import { kindOf } from "@/lib/inventory/item-kinds";
import { isWithinAsAt } from "@/lib/format";

const num = (v: any) => Number(v ?? 0);
const round = (n: number) => Math.round(n * 100) / 100;

/** Provider-agnostic open balance for a synced invoice/credit row (mirrors ar-snapshot). */
function openInvoiceBalance(inv: { qboBalance: number | null; xeroBalance: number | null; sageIntacctBalance: number | null; total: number; paid: number }): number {
  if (inv.qboBalance != null) return inv.qboBalance;
  if (inv.xeroBalance != null) return inv.xeroBalance;
  if (inv.sageIntacctBalance != null) return inv.sageIntacctBalance;
  return Math.max(0, num(inv.total) - num(inv.paid));
}

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const orgIds = [orgId!];
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + "-01";
  const yearStart = today.slice(0, 4) + "-01-01";

  const [org] = await db.select({ currency: organisations.currency }).from(organisations).where(eq(organisations.id, orgId!)).limit(1);
  const currency = org?.currency ?? "PKR";

  const [tb, plMtd, plYtd, bs] = await Promise.all([
    trialBalance(orgIds, today),
    profitAndLoss(orgIds, monthStart, today),
    profitAndLoss(orgIds, yearStart, today),
    balanceSheet(orgIds, today),
  ]);

  const sumType = (t: string) => round(tb.rows.filter(r => r.type === t).reduce((s, r) => s + r.debit - r.credit, 0));
  const cash = sumType("Bank");
  const glReceivable = sumType("Accounts Receivable");
  const glPayable = -sumType("Accounts Payable"); // AP is a credit-normal type; trialBalance nets debit-credit, so flip sign to a positive owed amount

  // ── Operational AR (synced invoices — matches the Collections dashboard) ──
  const invRows = await db.select({
    total: invoices.total, paid: invoices.paid, dueDate: invoices.dueDate, paymentStatus: invoices.paymentStatus,
    invoiceDate: invoices.invoiceDate, currency: invoices.currency,
    qboBalance: invoices.qboBalance, xeroBalance: invoices.xeroBalance, sageIntacctBalance: invoices.sageIntacctBalance,
  // Deleted in QuickBooks/Xero = never existed; the sync leaves its last balance on the row.
  }).from(invoices).where(and(eq(invoices.orgId, orgId!), isNull(invoices.deletedAt)));
  const arItems: OpenItem[] = [];
  for (const inv of invRows) {
    if (inv.paymentStatus === "Written Off") continue;
    // Same as-at rule the Collections dashboard applies (see CLAUDE.md): an
    // invoice dated after today has not been issued yet, so it is not
    // receivable. Without this the comment above — "matches the Collections
    // dashboard" — stops being true the moment an org post-dates an invoice.
    if (!isWithinAsAt(inv.invoiceDate, today)) continue;
    const bal = openInvoiceBalance(inv);
    if (Math.abs(bal) < 0.005) continue;
    arItems.push({ currency: inv.currency, balance: bal, dueDate: inv.dueDate });
  }
  // One figure per currency; the headline is the home currency only — see lib/ar-currency.ts.
  const arByCurrency = totalsByCurrency(arItems, currency, today);
  const arHome = headlineTotal(arByCurrency, currency);

  // ── Operational AP (bills — matches the Payables dashboard) ──
  const bills = await db.select({ balance: apBills.balance, dueDate: apBills.dueDate, currency: apBills.currency })
    .from(apBills)
    .where(and(eq(apBills.orgId, orgId!), inArray(apBills.accountingPaymentStatus, ["Unpaid", "Partially Paid"])));
  const apItems_: OpenItem[] = bills
    .filter((b) => num(b.balance) > 0)
    .map((b) => ({ currency: b.currency, balance: num(b.balance), dueDate: b.dueDate }));
  const apByCurrency = totalsByCurrency(apItems_, currency, today);
  const apHome = headlineTotal(apByCurrency, currency);

  // An org whose books are kept in QuickBooks/Xero has nothing in OUR general
  // ledger, so its GL figures read 0 — which looked like "AR in the books is
  // zero" beside a €2.85m receivable. Say "not held here" (null) instead.
  const ledgerHeld = !(await isSyncedOrg(orgId!));

  // ── Inventory value (FIFO cost cache, same figure Stock Valuation shows) ──
  const items = await db.select({ invValue: apItems.invValue, productType: apItems.productType }).from(apItems).where(eq(apItems.orgId, orgId!));
  const inventoryValue = round(items.filter(i => kindOf(i.productType).tracked).reduce((s, i) => s + num(i.invValue), 0));

  // ── Everything awaiting a human decision right now ──
  const pending = await db.select({ amount: pendingApprovals.amount, entityType: pendingApprovals.entityType })
    .from(pendingApprovals).where(and(eq(pendingApprovals.orgId, orgId!), eq(pendingApprovals.status, "Pending")));
  const pendingAmount = round(pending.reduce((s, p) => s + num(p.amount), 0));

  return ok({
    asOf: today,
    currency,
    cash: round(cash),
    // total/overdue/openCount are ONE currency — `ar.currency`, normally home
    // (see headlineTotal); byCurrency has every currency. glBalance is null when
    // the ledger is kept in QuickBooks/Xero.
    ledgerHeld,
    ar: { currency: arHome.currency, total: arHome.total, overdue: arHome.overdue, openCount: arHome.openCount, glBalance: ledgerHeld ? round(glReceivable) : null, byCurrency: arByCurrency },
    ap: { currency: apHome.currency, total: apHome.total, overdue: apHome.overdue, openCount: apHome.openCount, glBalance: ledgerHeld ? round(glPayable) : null, byCurrency: apByCurrency },
    inventoryValue,
    pendingApprovals: { count: pending.length, amount: pendingAmount },
    revenue: { mtd: plMtd.sections[0].total, ytd: plYtd.sections[0].total },
    grossProfit: { mtd: plMtd.grossProfit, ytd: plYtd.grossProfit },
    netProfit: { mtd: plMtd.netProfit, ytd: plYtd.netProfit },
    // Home currency only: a headline in another currency is left out rather than added to euros.
    workingCapital: round(cash + (arHome.currency === currency.toUpperCase() ? arHome.total : 0) + inventoryValue
      - (apHome.currency === currency.toUpperCase() ? apHome.total : 0)),
    ledgerIntegrity: { trialBalanceOk: tb.balanced, balanceSheetOk: bs.balanced },
  });
}
