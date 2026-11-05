// Aggregation for PAX Console's `analyze` tool, kept pure so the arithmetic is
// provable without a database.
//
// Why this exists: GET /api/invoices returns EVERY invoice with no filter, and a
// model can read at most 500 rows of it per call — it cannot total receivables
// by stage or by customer by paging. A question like "receivables by escalation
// stage" has to be answered where the data is. The rows come from the same AR
// aging engine the AR Aging report and the Dashboard use, so the numbers agree
// with the rest of the app.
//
// Money is NEVER added across currencies: every group and every total carries its
// currency, and a group is one (key, currency) pair.

export const RECEIVABLE_GROUPS = ["stage", "customer", "project", "currency", "bucket", "escalated_to", "escalation_type", "disputed"] as const;
export const PAYMENT_GROUPS = ["day", "month", "customer", "method", "currency"] as const;
export type ReceivableGroup = (typeof RECEIVABLE_GROUPS)[number];
export type PaymentGroup = (typeof PAYMENT_GROUPS)[number];

export const DEFAULT_LIMIT = 30;
export const MAX_LIMIT = 200;
/** The longest date range a payments question may span. */
export const MAX_RANGE_DAYS = 366;

export interface ArRow {
  customerId: string;
  customer: string;
  project: string | null;
  txnType: string;
  txnNumber: string;
  txnDate: string;
  dueDate: string;
  currency: string;
  openBalance: number;
  daysPastDue: number;
  bucket: string;
  stage: string;
  escalatedTo: string | null;
  escalationType: string | null;
  disputed: boolean;
  promiseDate: string | null;
}

export interface ReceivableFilters {
  stage?: string[];
  bucket?: string[];
  customer?: string;
  currency?: string;
  escalatedTo?: string;
  minDaysPastDue?: number;
  disputed?: boolean;
}

export interface PaymentRow {
  id: string;
  customerId: string | null;
  customer: string;
  txnDate: string;
  totalAmount: number;
  unappliedAmount: number;
  currency: string;
  method: string | null;
  ref: string | null;
  depositAccount: string | null;
}

export interface Group {
  key: string;
  currency: string;
  count: number;
  amount: number;
  /** Receivables only: the oldest overdue item in the group, in days. */
  oldestDaysPastDue?: number;
  /** Payments only: money received but not yet applied to an invoice. */
  unapplied?: number;
}

export interface Total { currency: string; count: number; amount: number; unapplied?: number }

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const lower = (s: string | null | undefined): string => (s ?? "").toLowerCase();

export const isDateString = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Whole days between two YYYY-MM-DD strings, with no Date built from a local time. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function filterReceivables(rows: readonly ArRow[], f: ReceivableFilters = {}): ArRow[] {
  const stages = f.stage?.map(lower);
  const buckets = f.bucket?.map(lower);
  return rows.filter((r) => {
    if (stages?.length && !stages.includes(lower(r.stage))) return false;
    if (buckets?.length && !buckets.includes(lower(r.bucket))) return false;
    if (f.customer && !lower(r.customer).includes(lower(f.customer))) return false;
    if (f.currency && lower(r.currency) !== lower(f.currency)) return false;
    if (f.escalatedTo && !lower(r.escalatedTo).includes(lower(f.escalatedTo))) return false;
    if (typeof f.minDaysPastDue === "number" && r.daysPastDue < f.minDaysPastDue) return false;
    if (typeof f.disputed === "boolean" && r.disputed !== f.disputed) return false;
    return true;
  });
}

function receivableKey(r: ArRow, by: ReceivableGroup): string {
  switch (by) {
    case "stage": return r.stage || "No stage";
    case "customer": return r.customer || "(unknown customer)";
    case "project": return r.project || "(no project)";
    case "currency": return r.currency;
    case "bucket": return r.bucket;
    case "escalated_to": return r.escalatedTo || "(not escalated)";
    case "escalation_type": return r.escalationType || "(none)";
    case "disputed": return r.disputed ? "Disputed" : "Not disputed";
  }
}

function totalsOf<T extends { currency: string }>(items: readonly T[], amount: (t: T) => number, unapplied?: (t: T) => number): Total[] {
  const by = new Map<string, Total>();
  for (const it of items) {
    const t = by.get(it.currency) ?? { currency: it.currency, count: 0, amount: 0, ...(unapplied ? { unapplied: 0 } : {}) };
    t.count += 1;
    t.amount += amount(it);
    if (unapplied) t.unapplied = (t.unapplied ?? 0) + unapplied(it);
    by.set(it.currency, t);
  }
  return [...by.values()].map((t) => ({ ...t, amount: round2(t.amount), ...(t.unapplied !== undefined ? { unapplied: round2(t.unapplied) } : {}) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface Summary<R> {
  groups: Group[];
  totals: Total[];
  /** Groups dropped by the limit, so a total that exceeds the shown groups is never a mystery. */
  moreGroups: number;
  rows: R[];
  moreRows: number;
}

export function summariseReceivables(rows: readonly ArRow[], opts: { groupBy?: ReceivableGroup; limit?: number; withRows?: boolean } = {}): Summary<ArRow> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const totals = totalsOf(rows, (r) => r.openBalance);
  let groups: Group[] = [];
  if (opts.groupBy) {
    const by = new Map<string, Group>();
    for (const r of rows) {
      const key = receivableKey(r, opts.groupBy);
      const id = `${key}\u0000${r.currency}`;
      const g = by.get(id) ?? { key, currency: r.currency, count: 0, amount: 0, oldestDaysPastDue: 0 };
      g.count += 1;
      g.amount += r.openBalance;
      g.oldestDaysPastDue = Math.max(g.oldestDaysPastDue ?? 0, r.daysPastDue);
      by.set(id, g);
    }
    groups = [...by.values()].map((g) => ({ ...g, amount: round2(g.amount) })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }
  const shownRows = opts.withRows || !opts.groupBy
    ? [...rows].sort((a, b) => Math.abs(b.openBalance) - Math.abs(a.openBalance)).slice(0, limit)
    : [];
  return {
    groups: groups.slice(0, limit),
    totals,
    moreGroups: Math.max(groups.length - limit, 0),
    rows: shownRows.map((r) => ({ ...r, openBalance: round2(r.openBalance) })),
    moreRows: shownRows.length ? Math.max(rows.length - shownRows.length, 0) : 0,
  };
}

function paymentKey(p: PaymentRow, by: PaymentGroup): string {
  switch (by) {
    case "day": return p.txnDate;
    case "month": return p.txnDate.slice(0, 7);
    case "customer": return p.customer || "(unknown customer)";
    case "method": return p.method || "(not recorded)";
    case "currency": return p.currency;
  }
}

export function summarisePayments(rows: readonly PaymentRow[], opts: { groupBy?: PaymentGroup; limit?: number } = {}): Summary<PaymentRow> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const totals = totalsOf(rows, (p) => p.totalAmount, (p) => p.unappliedAmount);
  let groups: Group[] = [];
  if (opts.groupBy) {
    const by = new Map<string, Group>();
    for (const p of rows) {
      const key = paymentKey(p, opts.groupBy);
      const id = `${key}\u0000${p.currency}`;
      const g = by.get(id) ?? { key, currency: p.currency, count: 0, amount: 0, unapplied: 0 };
      g.count += 1;
      g.amount += p.totalAmount;
      g.unapplied = (g.unapplied ?? 0) + p.unappliedAmount;
      by.set(id, g);
    }
    const byKey = opts.groupBy === "day" || opts.groupBy === "month";
    groups = [...by.values()].map((g) => ({ ...g, amount: round2(g.amount), unapplied: round2(g.unapplied ?? 0) }))
      .sort((a, b) => (byKey ? b.key.localeCompare(a.key) : Math.abs(b.amount) - Math.abs(a.amount)));
  }
  const shown = [...rows].sort((a, b) => b.txnDate.localeCompare(a.txnDate) || b.totalAmount - a.totalAmount).slice(0, limit);
  return {
    groups: groups.slice(0, limit),
    totals,
    moreGroups: Math.max(groups.length - limit, 0),
    rows: shown.map((p) => ({ ...p, totalAmount: round2(p.totalAmount), unappliedAmount: round2(p.unappliedAmount) })),
    moreRows: Math.max(rows.length - shown.length, 0),
  };
}
