/**
 * Budget maths — pure, no db (client-safe, same split as report-periods.ts).
 *
 * Budget amounts and P&L actuals are both in NATURAL sign (income positive,
 * expense positive), so they compare like with like. Variance is always
 * `actual - budget`; whether that is good news depends on the account:
 * income over budget is favourable, expense over budget is unfavourable.
 *
 * Months are calendar months of the budget's own year. Every date is a plain
 * YYYY-MM-DD string, never built through `new Date()` getters.
 */
import { typeDef } from "./account-types";

export type AccountKind = "income" | "expense";

export const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const pad2 = (n: number) => String(n).padStart(2, "0");
const r2 = (n: number) => Math.round(n * 100) / 100;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Income-side (credit-normal) or expense-side account. Type is authoritative; classification is the fallback. */
export function accountKind(type: string | null | undefined, classification: string | null | undefined): AccountKind {
  const def = typeDef(type);
  if (def) return def.normalBalance === "credit" ? "income" : "expense";
  return classification === "Revenue" ? "income" : "expense";
}

/** Only Profit & Loss accounts can be budgeted. */
export function isBudgetableAccount(a: { type?: string | null; classification?: string | null; isHeader?: boolean | null }): boolean {
  if (a.isHeader) return false;
  const def = typeDef(a.type);
  if (def) return def.statement === "profit_loss";
  return a.classification === "Revenue" || a.classification === "Expense";
}

export type MonthSpan = { month: number; label: string; from: string; to: string };

export function monthSpan(year: number, month: number): MonthSpan {
  return {
    month, label: MONTH_LABELS[month - 1],
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(daysIn(year, month))}`,
  };
}

export function allMonths(year: number): MonthSpan[] {
  return Array.from({ length: 12 }, (_, i) => monthSpan(year, i + 1));
}

/** Calendar months of `year` touched by [from, to] (whole months — a partial month counts). */
export function monthsInRange(year: number, from: string, to: string): MonthSpan[] {
  return allMonths(year).filter((m) => m.to >= from && m.from <= to);
}

export type Variance = {
  budget: number; actual: number;
  variance: number;           // actual - budget
  pct: number | null;         // variance / |budget| * 100; null with no budget
  favourable: boolean | null; // null when there is nothing to judge (both zero)
};

export function computeVariance(budget: number, actual: number, kind: AccountKind): Variance {
  const b = r2(budget), a = r2(actual);
  const variance = r2(a - b);
  const pct = b === 0 ? null : r2((variance / Math.abs(b)) * 100);
  let favourable: boolean | null;
  if (variance === 0) favourable = b === 0 && a === 0 ? null : true;
  else favourable = kind === "income" ? variance > 0 : variance < 0;
  return { budget: b, actual: a, variance, pct, favourable };
}

export type AccountRef = { id: string; name: string; code: string | null; type: string | null; classification: string | null };
export type VarianceRow = {
  accountId: string; name: string; code: string | null; kind: AccountKind;
  months: Record<number, Variance>;
  total: Variance;
};
export type BudgetLineIn = { accountId: string; month: number; amount: number };
export type ActualIn = { accountId: string; month: number; amount: number };

/**
 * One row per account over the chosen months, with a per-month cell and a
 * range total ("YTD"). Accounts with neither budget nor actual are dropped.
 */
export function buildVarianceRows(accounts: AccountRef[], lines: BudgetLineIn[], actuals: ActualIn[], months: number[]): VarianceRow[] {
  const inRange = new Set(months);
  const b = new Map<string, number>(), a = new Map<string, number>();
  const key = (id: string, m: number) => `${id}|${m}`;
  for (const l of lines) if (inRange.has(l.month)) b.set(key(l.accountId, l.month), (b.get(key(l.accountId, l.month)) ?? 0) + l.amount);
  for (const x of actuals) if (inRange.has(x.month)) a.set(key(x.accountId, x.month), (a.get(key(x.accountId, x.month)) ?? 0) + x.amount);

  const rows: VarianceRow[] = [];
  for (const acc of accounts) {
    const kind = accountKind(acc.type, acc.classification);
    const cells: Record<number, Variance> = {};
    let tb = 0, ta = 0;
    for (const m of months) {
      const bv = b.get(key(acc.id, m)) ?? 0, av = a.get(key(acc.id, m)) ?? 0;
      cells[m] = computeVariance(bv, av, kind);
      tb += bv; ta += av;
    }
    if (tb === 0 && ta === 0) continue;
    rows.push({ accountId: acc.id, name: acc.name, code: acc.code, kind, months: cells, total: computeVariance(tb, ta, kind) });
  }
  return rows.sort((x, y) => (x.code ?? "").localeCompare(y.code ?? "") || x.name.localeCompare(y.name));
}

/** Profit = income - expense, with the income rule applied to the result. */
export function summariseProfit(rows: VarianceRow[]): Variance {
  let bi = 0, ai = 0, be = 0, ae = 0;
  for (const r of rows) {
    if (r.kind === "income") { bi += r.total.budget; ai += r.total.actual; }
    else { be += r.total.budget; ae += r.total.actual; }
  }
  return computeVariance(bi - be, ai - ae, "income");
}

// Minimal structural shape of profitAndLoss()'s result, so this stays db-free.
type PlLines = { lines: { accountId: string | null; amount: number }[] };
export type PlShape = { sections: PlLines[]; otherIncome: PlLines; operatingExpenses: PlLines; financeCosts: PlLines; taxation: PlLines };

/** accountId -> natural-sign amount, across every P&L section. */
export function flattenPl(pl: PlShape): Map<string, number> {
  const out = new Map<string, number>();
  const groups: PlLines[] = [...pl.sections, pl.otherIncome, pl.operatingExpenses, pl.financeCosts, pl.taxation];
  for (const g of groups) for (const l of g.lines) {
    if (l.accountId) out.set(l.accountId, r2((out.get(l.accountId) ?? 0) + l.amount));
  }
  return out;
}

/** Copy-from-actuals seed: prior-year actuals become the new budget's lines (non-zero only). */
export function seedLinesFromActuals(actuals: ActualIn[], uplift = 0): BudgetLineIn[] {
  const f = 1 + uplift / 100;
  return actuals
    .filter((x) => x.amount !== 0 && x.month >= 1 && x.month <= 12)
    .map((x) => ({ accountId: x.accountId, month: x.month, amount: r2(x.amount * f) }));
}

/** Parse an editor cell: blank or junk is 0, never NaN. */
export function parseAmount(s: string | number | null | undefined): number {
  const n = typeof s === "number" ? s : parseFloat(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? r2(n) : 0;
}

export function rowTotal(amounts: Record<number, number>): number {
  return r2(Object.values(amounts).reduce((s, v) => s + v, 0));
}
