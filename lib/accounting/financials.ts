/**
 * Financial statement engine — builds the Trial Balance, Profit & Loss and
 * Balance Sheet straight from the general ledger (journal_lines of Posted
 * entries), grouped into IFRS sections via the account-type taxonomy.
 *
 * Money is stored as numeric(14,2) → strings in Drizzle; coerced with Number().
 * Only Posted entries count (reversals net themselves out because the reversal
 * is a separate Posted entry with the opposite sides).
 *
 * Net income & closing: with no period close yet, income/expense accounts hold
 * all-time balances, so the Balance Sheet's equity carries a computed
 * "Profit for the period" line = all-time (Income − Expense) to the report
 * date. That is exactly what makes A = E + L balance, and it splits into
 * Retained Earnings (closed years) + current-year profit once period close
 * ships. Fiscal-year handling is calendar-year for now (configurable later).
 */

import { db } from "@/db";
import { journalLines, journalEntries, accounts } from "@/db/schema";
import { and, eq, ne, inArray, gte, lte, sql } from "drizzle-orm";
import { typeDef, type Classification, type Statement } from "./account-types";
import { isProvision, isOciReserve, equityCategory } from "./ifrs";

export type AccountBalance = {
  accountId: string; name: string; code: string | null;
  type: string | null; classification: string | null; subtype: string | null;
  debit: number; credit: number;   // period movements
};

type Placed = { statement: Statement; section: string; normal: "debit" | "credit" };

export function place(type: string | null, classification: string | null): Placed {
  const def = typeDef(type);
  if (def) return { statement: def.statement, section: def.section, normal: def.normalBalance };
  // `classification` alone (no recognized `type`) still places a Liability/
  // Equity/Revenue account correctly below — this only guesses wrong when
  // BOTH are unrecognized, which happens when a provider sync (QBO/Xero)
  // writes a type string this app's taxonomy doesn't know, e.g. a Xero
  // AccountType the translation map in xero-ap-sync.ts didn't cover (that
  // exact bug — PAYGLIABILITY/SUPERANNUATIONLIABILITY — shipped once; see
  // CLAUDE.md "Chart of Accounts wiring" note). Logged loudly rather than
  // silently reported as a debit-normal Current Asset, so a future gap in
  // that map surfaces immediately instead of quietly misstating the Balance
  // Sheet for weeks.
  if (classification !== "Asset" && classification !== "Liability" && classification !== "Equity" && classification !== "Revenue" && classification !== "Expense") {
    console.error(`[financials.place] unrecognized account type="${type}" classification="${classification}" — defaulting to Current Asset. Check the provider sync's type-translation map.`);
  }
  switch (classification as Classification) {
    case "Asset":     return { statement: "balance_sheet", section: "Current Assets", normal: "debit" };
    case "Liability": return { statement: "balance_sheet", section: "Current Liabilities", normal: "credit" };
    case "Equity":    return { statement: "balance_sheet", section: "Equity", normal: "credit" };
    case "Revenue":   return { statement: "profit_loss", section: "Revenue", normal: "credit" };
    case "Expense":   return { statement: "profit_loss", section: "Operating Expenses", normal: "debit" };
    default:          return { statement: "balance_sheet", section: "Current Assets", normal: "debit" };
  }
}

/** Signed balance in the account's natural direction (positive = normal side). */
function natural(b: AccountBalance): number {
  const { normal } = place(b.type, b.classification);
  const n = normal === "debit" ? b.debit - b.credit : b.credit - b.debit;
  return Math.round(n * 100) / 100;
}

async function balances(orgIds: string[], opts: { from?: string; to?: string; excludeClosing?: boolean } = {}): Promise<AccountBalance[]> {
  if (orgIds.length === 0) return [];
  // Include BOTH Posted and Reversed: reversing flips the original to
  // "Reversed" and adds an opposite "Posted" reversal, so the pair nets to zero.
  // Filtering to Posted-only would drop the original and falsify every total.
  const conds = [inArray(journalLines.orgId, orgIds), inArray(journalEntries.status, ["Posted", "Reversed"])];
  if (opts.from) conds.push(gte(journalEntries.entryDate, opts.from));
  if (opts.to)   conds.push(lte(journalEntries.entryDate, opts.to));
  // Year-end closing entries move P&L to Retained Earnings; excluding them keeps
  // the P&L report showing real trading activity (the Balance Sheet includes them).
  if (opts.excludeClosing) conds.push(ne(journalEntries.sourceType, "Closing"));

  const rows = await db
    .select({
      accountId: journalLines.accountId,
      name: accounts.name, code: accounts.code, type: accounts.type, classification: accounts.classification, subtype: accounts.subtype,
      debit: sql<string>`sum(${journalLines.debit})`, credit: sql<string>`sum(${journalLines.credit})`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(...conds))
    .groupBy(journalLines.accountId, accounts.name, accounts.code, accounts.type, accounts.classification, accounts.subtype);

  return rows.map((r) => ({
    accountId: r.accountId, name: r.name, code: r.code, type: r.type, classification: r.classification, subtype: r.subtype,
    debit: Number(r.debit ?? 0), credit: Number(r.credit ?? 0),
  }));
}

const round = (n: number) => Math.round(n * 100) / 100;

// ── Trial Balance ─────────────────────────────────────────────────────────────
export async function trialBalance(orgIds: string[], asOf?: string) {
  const bs = await balances(orgIds, { to: asOf });
  const rows = bs
    .map((b) => {
      const net = round(b.debit - b.credit);
      return { accountId: b.accountId, name: b.name, code: b.code, type: b.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0)
    .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "") || a.name.localeCompare(b.name));
  const totalDebit = round(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = round(rows.reduce((s, r) => s + r.credit, 0));
  return { asOf: asOf ?? null, rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
}

// ── Profit & Loss ──────────────────────────────────────────────────────────────
type PlLine = { accountId: string | null; name: string; code: string | null; amount: number };
export async function profitAndLoss(orgIds: string[], from?: string, to?: string) {
  const bs = (await balances(orgIds, { from, to, excludeClosing: true })).filter((b) => place(b.type, b.classification).statement === "profit_loss");
  const bySection = (section: string): PlLine[] =>
    bs.filter((b) => place(b.type, b.classification).section === section)
      .map((b) => ({ accountId: b.accountId, name: b.name, code: b.code, amount: natural(b) }))
      .filter((l) => l.amount !== 0)
      .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
  const sum = (ls: PlLine[]) => round(ls.reduce((s, l) => s + l.amount, 0));

  const revenue = bySection("Revenue");
  const costOfSales = bySection("Cost of Sales");
  const otherIncome = bySection("Other Income");
  const opex = bySection("Operating Expenses");
  const finance = bySection("Finance Costs");
  const tax = bySection("Taxation");

  const revenueTotal = sum(revenue), cosTotal = sum(costOfSales), otherIncomeTotal = sum(otherIncome);
  const opexTotal = sum(opex), financeTotal = sum(finance), taxTotal = sum(tax);
  const grossProfit = round(revenueTotal - cosTotal);
  const profitBeforeTax = round(grossProfit + otherIncomeTotal - opexTotal - financeTotal);
  const netProfit = round(profitBeforeTax - taxTotal);

  return {
    from: from ?? null, to: to ?? null,
    sections: [
      { section: "Revenue", lines: revenue, total: revenueTotal },
      { section: "Cost of Sales", lines: costOfSales, total: cosTotal },
    ],
    grossProfit,
    otherIncome: { lines: otherIncome, total: otherIncomeTotal },
    operatingExpenses: { lines: opex, total: opexTotal },
    financeCosts: { lines: finance, total: financeTotal },
    profitBeforeTax,
    taxation: { lines: tax, total: taxTotal },
    netProfit,
  };
}

// ── Balance Sheet ────────────────────────────────────────────────────────────
type BsLine = { accountId: string | null; name: string; code: string | null; amount: number };

/** First day of the fiscal year on or before `dateStr`, given the FY start month (1-12). */
function fyStartOnOrBefore(dateStr: string, m: number): string {
  const [y, mm] = dateStr.split("-").map(Number);
  const year = mm < m ? y - 1 : y;
  return `${year}-${String(m).padStart(2, "0")}-01`;
}
function dayBefore(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Net P&L movement (credit-positive) within a balances() result — shared by balanceSheet(), comprehensiveIncome() and statementOfChangesInEquity() so "what counts as profit" can never drift between them. */
function plNet(bs: AccountBalance[]): number {
  return round(bs
    .filter((b) => place(b.type, b.classification).statement === "profit_loss")
    .reduce((s, b) => { const p = place(b.type, b.classification); return s + (p.normal === "credit" ? b.credit - b.debit : -(b.debit - b.credit)); }, 0));
}

export async function balanceSheet(orgIds: string[], asOf?: string, fyStartMonth = 1) {
  const all = await balances(orgIds, { to: asOf });
  const bsAccts = all.filter((b) => place(b.type, b.classification).statement === "balance_sheet");
  // IAS 37: provisions are shown as their own line, separate from ordinary
  // current/non-current liabilities, even though they still live in the
  // SAME two sections for GL placement (place() never changes). `pred`
  // lets the two helpers below peel provision-subtype accounts out of
  // "Non-current Liabilities"/"Current Liabilities" into their own line,
  // and vice versa, without maintaining two independent filter predicates
  // that could silently drift apart and double-count or drop an account.
  const bySection = (section: string, pred: (b: AccountBalance) => boolean = () => true): BsLine[] =>
    bsAccts.filter((b) => place(b.type, b.classification).section === section && pred(b))
      .map((b) => ({ accountId: b.accountId, name: b.name, code: b.code, amount: natural(b) }))
      .filter((l) => l.amount !== 0)
      .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
  const sum = (ls: BsLine[]) => round(ls.reduce((s, l) => s + l.amount, 0));

  const isProvisionAcct = (b: AccountBalance) => isProvision(b.subtype);
  const notProvision = (b: AccountBalance) => !isProvisionAcct(b);
  const ncAssets = bySection("Non-current Assets");
  const cAssets = bySection("Current Assets");
  const equity = bySection("Equity");
  const ncLiab = bySection("Non-current Liabilities", notProvision);
  const cLiab = bySection("Current Liabilities", notProvision);
  const ncProvisions = bySection("Non-current Liabilities", isProvisionAcct);
  const cProvisions = bySection("Current Liabilities", isProvisionAcct);

  // Net income, split by fiscal year. PRIOR fiscal years roll into Retained
  // Earnings automatically the moment a new year starts (QBO/QBD behaviour — no
  // manual entry needed); the CURRENT fiscal year shows as Profit for the
  // period. Explicit closing entries, if used, are already in these balances,
  // so this can't double count either way.
  const refDate = asOf ?? new Date().toISOString().slice(0, 10);
  const fyStart = fyStartOnOrBefore(refDate, fyStartMonth);
  const priorEarnings = plNet(await balances(orgIds, { to: dayBefore(fyStart) }));
  const currentProfit = plNet(await balances(orgIds, { from: fyStart, to: asOf }));

  const totalAssets = round(sum(ncAssets) + sum(cAssets));
  const equityWithProfit = [
    ...equity,
    ...(priorEarnings !== 0 ? [{ accountId: null, name: "Retained Earnings", code: null, amount: priorEarnings }] : []),
    { accountId: null, name: "Profit for the period", code: null, amount: currentProfit },
  ];
  const totalEquity = round(sum(equity) + priorEarnings + currentProfit);
  const totalProvisions = round(sum(ncProvisions) + sum(cProvisions));
  const totalLiabilities = round(sum(ncLiab) + sum(cLiab) + totalProvisions);

  return {
    asOf: asOf ?? null,
    assets: { nonCurrent: ncAssets, current: cAssets, total: totalAssets },
    equity: { lines: equityWithProfit, total: totalEquity },
    liabilities: { nonCurrent: ncLiab, current: cLiab, total: totalLiabilities },
    // IAS 37: provisions shown as their own Balance Sheet line, separate
    // from other current/non-current liabilities — already included in
    // `liabilities.total`/`totalEquityAndLiabilities` above, so a caller
    // that only reads `liabilities` (as the existing report page does)
    // still sees a balanced total; this is purely an additional, more
    // granular view for a caller that wants to show it separately.
    provisions: { nonCurrent: ncProvisions, current: cProvisions, total: totalProvisions },
    totalEquityAndLiabilities: round(totalEquity + totalLiabilities),
    balanced: Math.abs(totalAssets - (totalEquity + totalLiabilities)) < 0.01,
  };
}

// ── Statement of Comprehensive Income (IAS 1) ───────────────────────────────
// P&L's net profit, plus Other Comprehensive Income: movements that bypass
// profit or loss but still change equity directly — revaluation surpluses,
// foreign-currency translation differences, fair-value-through-OCI
// gains/losses (lib/accounting/ifrs.ts's isOciReserve()). These are reserve
// ACCOUNTS whose period movement is read the same way any equity account's
// is (natural(), credit-positive) — nothing currently posts to them (no
// revaluation/translation/fair-value posting path exists yet), so on every
// org today this adds a zero OCI section on top of the unchanged P&L.
export async function comprehensiveIncome(orgIds: string[], from?: string, to?: string) {
  const pl = await profitAndLoss(orgIds, from, to);
  const periodBs = await balances(orgIds, { from, to, excludeClosing: true });
  const ociLines: PlLine[] = periodBs
    .filter((b) => {
      const p = place(b.type, b.classification);
      return p.statement === "balance_sheet" && p.section === "Equity" && isOciReserve(b.subtype);
    })
    .map((b) => ({ accountId: b.accountId, name: b.name, code: b.code, amount: natural(b) }))
    .filter((l) => l.amount !== 0)
    .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
  const ociTotal = round(ociLines.reduce((s, l) => s + l.amount, 0));
  return {
    ...pl,
    oci: { lines: ociLines, total: ociTotal },
    totalComprehensiveIncome: round(pl.netProfit + ociTotal),
  };
}

// ── Statement of Changes in Equity ──────────────────────────────────────────
// For the period [from, to]: opening balance per equity category, the
// period's movements split into Profit for the period (rolled into Retained
// earnings — there is no period-close journal entry that actually moves P&L
// into a Retained Earnings account yet, so this computes it live, exactly as
// balanceSheet()'s "Profit for the period" line does), Other Comprehensive
// Income (Other reserves), and ordinary capital transactions (share
// issues/distributions, via lib/accounting/ifrs.ts's equityCategory()), and
// the resulting closing balance. The grand total ties to balanceSheet()'s
// equity.total at `to` — proven in tests/ifrs-statements.test.ts.
const EQUITY_CATEGORIES = [
  { key: "shareCapital", label: "Share capital & premium" },
  { key: "retainedEarnings", label: "Retained earnings" },
  { key: "otherReserves", label: "Other reserves" },
  { key: "distributions", label: "Distributions" },
] as const;

export async function statementOfChangesInEquity(orgIds: string[], from: string, to: string) {
  const openingBs = await balances(orgIds, { to: dayBefore(from) });
  const periodBs = await balances(orgIds, { from, to, excludeClosing: true });

  const isEquityAcct = (b: AccountBalance) => {
    const p = place(b.type, b.classification);
    return p.statement === "balance_sheet" && p.section === "Equity";
  };
  const sumByCategory = (bs: AccountBalance[], key: string) =>
    round(bs.filter((b) => isEquityAcct(b) && equityCategory(b.subtype) === key).reduce((s, b) => s + natural(b), 0));

  const profitForPeriod = plNet(periodBs);

  const rows = EQUITY_CATEGORIES.map(({ key, label }) => {
    const opening = sumByCategory(openingBs, key);
    // Profit for the period isn't yet reflected in any equity ACCOUNT's
    // balance (see the comment above) — only Retained earnings' row gets it
    // added as a movement on top of whatever its own accounts moved by.
    const ownMovement = sumByCategory(periodBs, key);
    const movement = key === "retainedEarnings" ? round(ownMovement + profitForPeriod) : ownMovement;
    const closing = round(opening + movement);
    return { category: key, label, opening, movement, closing };
  });

  const totalOpening = round(rows.reduce((s, r) => s + r.opening, 0));
  const totalMovement = round(rows.reduce((s, r) => s + r.movement, 0));
  const totalClosing = round(rows.reduce((s, r) => s + r.closing, 0));

  return { from, to, rows, totalOpening, totalMovement, totalClosing };
}

// ── Multi-column (period-bucket / compare-to) wrappers ──────────────────────
// Each calls the existing single-period `profitAndLoss`/`balanceSheet` once
// per column and zips the results by account — those functions are
// completely unchanged, so every existing caller (Cash Flow, reconcile,
// tests) is unaffected whether this is ever used or not. This is the engine
// behind the report page's "Display columns by" and "Compare to" controls.
export type ReportColumnMeta = { key: string; label: string; from?: string; to?: string; asOf?: string };
type MultiLine = { accountId: string | null; name: string; code: string | null; values: number[] };

/** Union of lines across columns, keyed by accountId (fallback to name for a
 *  synthetic line like "Profit for the period" which carries accountId: null),
 *  each column's amount zipped into `values[]` (0 where that column has none). */
function zipLines(perColumn: PlLine[][] | BsLine[][]): MultiLine[] {
  const order: string[] = [];
  const byKey = new Map<string, MultiLine>();
  perColumn.forEach((lines, colIdx) => {
    for (const l of lines) {
      const k = l.accountId ?? `~${l.name}`;
      let row = byKey.get(k);
      if (!row) { row = { accountId: l.accountId, name: l.name, code: l.code, values: perColumn.map(() => 0) }; byKey.set(k, row); order.push(k); }
      row.values[colIdx] = l.amount;
    }
  });
  return order.map((k) => byKey.get(k)!);
}

export async function multiPeriodProfitAndLoss(orgIds: string[], periods: { key: string; label: string; from: string; to: string }[]) {
  const results = await Promise.all(periods.map((p) => profitAndLoss(orgIds, p.from, p.to)));
  const columns: ReportColumnMeta[] = periods.map((p) => ({ key: p.key, label: p.label, from: p.from, to: p.to }));
  return {
    columns,
    revenue: { rows: zipLines(results.map((r) => r.sections[0].lines)), totals: results.map((r) => r.sections[0].total) },
    costOfSales: { rows: zipLines(results.map((r) => r.sections[1].lines)), totals: results.map((r) => r.sections[1].total) },
    grossProfit: results.map((r) => r.grossProfit),
    otherIncome: { rows: zipLines(results.map((r) => r.otherIncome.lines)), totals: results.map((r) => r.otherIncome.total) },
    operatingExpenses: { rows: zipLines(results.map((r) => r.operatingExpenses.lines)), totals: results.map((r) => r.operatingExpenses.total) },
    financeCosts: { rows: zipLines(results.map((r) => r.financeCosts.lines)), totals: results.map((r) => r.financeCosts.total) },
    profitBeforeTax: results.map((r) => r.profitBeforeTax),
    taxation: { rows: zipLines(results.map((r) => r.taxation.lines)), totals: results.map((r) => r.taxation.total) },
    netProfit: results.map((r) => r.netProfit),
  };
}

export async function multiAsOfBalanceSheet(orgIds: string[], snapshots: { key: string; label: string; asOf: string }[], fyStartMonth = 1) {
  const results = await Promise.all(snapshots.map((s) => balanceSheet(orgIds, s.asOf, fyStartMonth)));
  const columns: ReportColumnMeta[] = snapshots.map((s) => ({ key: s.key, label: s.label, asOf: s.asOf }));
  const sumAmt = (ls: BsLine[]) => round(ls.reduce((s, l) => s + l.amount, 0));
  return {
    columns,
    assets: {
      nonCurrent: { rows: zipLines(results.map((r) => r.assets.nonCurrent)), totals: results.map((r) => sumAmt(r.assets.nonCurrent)) },
      current: { rows: zipLines(results.map((r) => r.assets.current)), totals: results.map((r) => sumAmt(r.assets.current)) },
      total: results.map((r) => r.assets.total),
    },
    equity: { rows: zipLines(results.map((r) => r.equity.lines)), totals: results.map((r) => r.equity.total) },
    liabilities: {
      nonCurrent: { rows: zipLines(results.map((r) => r.liabilities.nonCurrent)), totals: results.map((r) => sumAmt(r.liabilities.nonCurrent)) },
      current: { rows: zipLines(results.map((r) => r.liabilities.current)), totals: results.map((r) => sumAmt(r.liabilities.current)) },
      total: results.map((r) => r.liabilities.total),
    },
    totalEquityAndLiabilities: results.map((r) => r.totalEquityAndLiabilities),
    balanced: results.map((r) => r.balanced),
  };
}

// ── General Ledger ───────────────────────────────────────────────────────────
// Per-account transaction listing with a running balance — the classic ledger
// where every line shows the NATURE of the posting (Invoice, Bill, Payment…),
// its document number and backend TXN id. This is what a CA "opens the ledger"
// to see. Optionally scoped to one account and/or a date window.
export async function generalLedger(orgIds: string[], opts: { accountId?: string; from?: string; to?: string; customerId?: string; projectId?: string; nameId?: string } = {}) {
  if (orgIds.length === 0) return { accounts: [] as any[] };

  // Accounts in scope (single, or all that have movement).
  const acctRows = await db.select({ id: accounts.id, name: accounts.name, code: accounts.code, type: accounts.type, classification: accounts.classification })
    .from(accounts)
    .where(opts.accountId ? and(inArray(accounts.orgId, orgIds), eq(accounts.id, opts.accountId)) : inArray(accounts.orgId, orgIds));
  const acctById = new Map(acctRows.map(a => [a.id, a]));

  // Include BOTH Posted and Reversed: reversing flips the original to
  // "Reversed" and adds an opposite "Posted" reversal, so the pair nets to zero.
  // Filtering to Posted-only would drop the original and falsify every total.
  const conds = [inArray(journalLines.orgId, orgIds), inArray(journalEntries.status, ["Posted", "Reversed"])];
  if (opts.accountId) conds.push(eq(journalLines.accountId, opts.accountId));
  if (opts.to) conds.push(lte(journalEntries.entryDate, opts.to));
  // Dimension filters — Customer/Project/Supplier ("Supplier" is nameId,
  // since AP has no dedicated supplierId column; the party is carried via
  // the same generic nameType/nameId QBO-style pair used for AR).
  if (opts.customerId) conds.push(eq(journalLines.customerId, opts.customerId));
  if (opts.projectId) conds.push(eq(journalLines.projectId, opts.projectId));
  if (opts.nameId) conds.push(eq(journalLines.nameId, opts.nameId));

  const rows = await db.select({
    accountId: journalLines.accountId,
    entryId: journalEntries.id,
    date: journalEntries.entryDate,
    sourceType: journalEntries.sourceType,
    docNumber: journalEntries.docNumber,
    entryNumber: journalEntries.entryNumber,
    txnNo: journalEntries.txnNo,
    memo: journalEntries.memo,
    description: journalLines.description,
    nameLabel: journalLines.nameLabel,
    customerId: journalLines.customerId,
    projectId: journalLines.projectId,
    lineNo: journalLines.lineNo,
    debit: journalLines.debit,
    credit: journalLines.credit,
    // Original foreign-currency amount/rate for this line, if it was entered
    // in a foreign currency (populated by lib/accounting/documents.ts's
    // toHome()) — null when the line was already home-currency. Home-currency
    // debit/credit above (the GL truth) and opening/running balance below are
    // completely unaffected by these; they're purely for an optional display.
    currency: journalLines.currency,
    exchangeRate: journalLines.exchangeRate,
    fxDebit: journalLines.fxDebit,
    fxCredit: journalLines.fxCredit,
  }).from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(...conds))
    .orderBy(journalEntries.entryDate, journalEntries.entryNumber, journalLines.lineNo);

  // Group per account; opening balance = movement strictly before `from`.
  const byAccount = new Map<string, typeof rows>();
  for (const r of rows) {
    if (opts.accountId && r.accountId !== opts.accountId) continue;
    let arr = byAccount.get(r.accountId);
    if (!arr) { arr = []; byAccount.set(r.accountId, arr); }
    arr.push(r);
  }

  const out = [...byAccount.entries()].map(([accountId, list]) => {
    const acct = acctById.get(accountId);
    let opening = 0;
    const ledgerRows: any[] = [];
    let balance = 0;
    for (const r of list) {
      const d = Number(r.debit ?? 0), c = Number(r.credit ?? 0);
      if (opts.from && r.date < opts.from) { opening = round(opening + d - c); continue; }
      balance = round((ledgerRows.length ? balance : opening) + d - c);
      ledgerRows.push({
        entryId: r.entryId, date: r.date, sourceType: r.sourceType, docNumber: r.docNumber ?? `JE-${r.entryNumber}`, txnNo: r.txnNo,
        name: r.nameLabel ?? null, memo: r.description || r.memo || null,
        debit: round(d), credit: round(c), balance,
        currency: r.currency ?? null, exchangeRate: r.exchangeRate != null ? Number(r.exchangeRate) : null,
        fxDebit: r.fxDebit != null ? Number(r.fxDebit) : null, fxCredit: r.fxCredit != null ? Number(r.fxCredit) : null,
      });
    }
    if (ledgerRows.length === 0 && opening === 0) return null;
    return {
      account: acct ? { id: acct.id, name: acct.name, code: acct.code, type: acct.type } : { id: accountId, name: "—", code: null, type: null },
      opening: round(opening), rows: ledgerRows, closing: round(ledgerRows.length ? balance : opening),
    };
  }).filter(Boolean)
    .sort((a: any, b: any) => (a.account.code ?? "").localeCompare(b.account.code ?? "") || a.account.name.localeCompare(b.account.name));

  return { accounts: out };
}
