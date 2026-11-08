/**
 * Accounting dashboard — pure rules (no db). The route in
 * app/api/accounting/dashboard reads the data; everything that decides a
 * number lives here so it can be tested.
 *
 * Dates are YYYY-MM-DD strings throughout and are compared as strings
 * ("a date is a date" — never `new Date()` on a calendar date).
 */

const DAYS_IN_MONTH = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");

/** Add `days` to a YYYY-MM-DD date (calendar arithmetic, UTC-safe). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * This month to date, and the SAME span of last month. Comparing a full last
 * month with half of this one would make every month look like a fall on the
 * 15th. The day is clamped (31 Mar compares with 1–28/29 Feb).
 */
export function monthToDateWindows(today: string): {
  current: { from: string; to: string };
  previous: { from: string; to: string };
} {
  const [y, m, d] = today.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const pd = Math.min(d, DAYS_IN_MONTH(py, pm));
  return {
    current: { from: `${y}-${pad(m)}-01`, to: today },
    previous: { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(pd)}` },
  };
}

export type OpenItem = { currency: string; balance: number; dueDate: string | null };
export type CashFlowRow = { currency: string; overdue: number; next30: number };

/**
 * Money expected in (receivables) or out (payables), per currency: already
 * overdue, and falling due in the next `days` days. A row with no due date is
 * treated as due now — it is owed and nothing says it can wait. Currencies are
 * never added together.
 */
export function dueWithin(items: OpenItem[], today: string, days = 30): CashFlowRow[] {
  const horizon = addDaysYmd(today, days);
  const by = new Map<string, CashFlowRow>();
  for (const it of items) {
    if (!(it.balance > 0.005)) continue;
    const row = by.get(it.currency) ?? { currency: it.currency, overdue: 0, next30: 0 };
    const due = it.dueDate ? it.dueDate.slice(0, 10) : null;
    if (!due || due < today) row.overdue += it.balance;
    else if (due <= horizon) row.next30 += it.balance;
    by.set(it.currency, row);
  }
  return Array.from(by.values())
    .map((r) => ({ ...r, overdue: round2(r.overdue), next30: round2(r.next30) }))
    .filter((r) => r.overdue !== 0 || r.next30 !== 0)
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Percentage change, or null when there is nothing to compare with. */
export function changePct(current: number, previous: number): number | null {
  if (Math.abs(previous) < 0.005) return null;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

/** Margin %, or null with no revenue (a margin on nothing is not 0%). */
export function marginPct(profit: number, revenue: number): number | null {
  if (Math.abs(revenue) < 0.005) return null;
  return round2((profit / revenue) * 100);
}

export type ExpenseLine = { accountId: string | null; name: string; code: string | null; amount: number };

/** The largest expense accounts, biggest first. Credits (refunds) are not "top spend". */
export function topExpenses(lines: ExpenseLine[], n = 5): ExpenseLine[] {
  return lines.filter((l) => l.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, n);
}

/** A bank account counts as stale when it was never reconciled, or not in `days` days. */
export function isReconciliationStale(lastStatementDate: string | null, today: string, days = 30): boolean {
  if (!lastStatementDate) return true;
  return lastStatementDate.slice(0, 10) < addDaysYmd(today, -days);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
