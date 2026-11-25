/**
 * Budget vs Actual → export model, plus the group/month variance helpers the
 * page ALSO uses — one implementation, so the screen and the export cannot
 * round differently. PURE.
 */
import type { Variance, VarianceRow } from "@/lib/accounting/budgets";
import { num, type Cell, type ExportColumn, type ExportRow, type ReportExportModel } from "../export-model";

type Kind = "income" | "expense" | "profit";

/** Variance of a total (budget vs actual) for a row kind. Same math the page shows. */
export function varianceOf(budget: number, actual: number, kind: Kind): Variance {
  const variance = Math.round((actual - budget) * 100) / 100;
  return {
    budget, actual, variance,
    pct: budget === 0 ? null : Math.round((variance / Math.abs(budget)) * 10000) / 100,
    favourable: actual === budget ? true : kind === "expense" ? actual < budget : actual > budget,
  };
}

/** A group's overall total across its rows. */
export function groupTotal(rows: VarianceRow[]): Variance {
  const s = rows.reduce((a, r) => ({ b: a.b + r.total.budget, a: a.a + r.total.actual }), { b: 0, a: 0 });
  return varianceOf(s.b, s.a, rows[0]?.kind === "income" ? "income" : "expense");
}

/** One month's budget and actual summed over a group's rows. */
export function monthSum(rows: VarianceRow[], month: number): { b: number; a: number } {
  return rows.reduce((s, r) => ({ b: s.b + r.months[month].budget, a: s.a + r.months[month].actual }), { b: 0, a: 0 });
}

export interface BudgetInfo {
  entity: string;
  currency: string | null;
  budgetName: string;
  periodLine: string;
  byMonth: boolean;
}

export function buildBudgetModel(data: { rows: VarianceRow[]; profit: Variance; months: { month: number; label: string }[] }, info: BudgetInfo): ReportExportModel {
  const income = data.rows.filter((r) => r.kind === "income");
  const expense = data.rows.filter((r) => r.kind === "expense");
  const cols = info.byMonth ? data.months : [];

  const columns: ExportColumn[] = [
    { key: "account", label: "Account", kind: "text" },
    { key: "budget", label: "Budget", kind: "money" },
    { key: "actual", label: "Actual", kind: "money" },
    { key: "variance", label: "Variance", kind: "variance" },
    { key: "pct", label: "Var %", kind: "percent" },
    ...cols.map((m): ExportColumn => ({ key: `m${m.month}`, label: m.label, kind: "variance" })),
  ];

  const monthCell = (v: Variance): Cell => (v.variance === 0 ? "—" : num(v.variance));
  const totals = (v: Variance): Cell[] => [num(v.budget), num(v.actual), num(v.variance), v.pct == null ? "—" : num(v.pct)];
  // The screen's only exception cue: red for an unfavourable variance. Carried as per-cell flags so Excel and PDF can show it.
  const bad = (v: Variance) => v.favourable === false;
  const flagsFor = (total: Variance, monthly: Variance[]): boolean[] => [false, false, false, bad(total), bad(total), ...monthly.map(bad)];

  const group = (title: string, rows: VarianceRow[]): ExportRow[] => {
    if (!rows.length) return [];
    const kind = rows[0].kind === "income" ? "income" : "expense";
    return [
      { kind: "heading", cells: [title, ...Array(columns.length - 1).fill(null)] },
      ...rows.map((r): ExportRow => ({
        kind: "line", indent: 1,
        cells: [`${r.code ? `${r.code} ` : ""}${r.name}`, ...totals(r.total), ...cols.map((m) => monthCell(r.months[m.month]))],
        flags: flagsFor(r.total, cols.map((m) => r.months[m.month])),
      })),
      (() => {
        const monthly = cols.map((m) => { const s = monthSum(rows, m.month); return varianceOf(s.b, s.a, kind); });
        const t = groupTotal(rows);
        return { kind: "subtotal", cells: [`Total ${title.toLowerCase()}`, ...totals(t), ...monthly.map(monthCell)], flags: flagsFor(t, monthly) } as ExportRow;
      })(),
    ];
  };

  const profitMonthly = cols.map((m) => {
    const i = monthSum(income, m.month), e = monthSum(expense, m.month);
    return varianceOf(i.b - e.b, i.a - e.a, "profit");
  });
  const profitRow: ExportRow = {
    kind: "total",
    cells: ["Profit", ...totals(data.profit), ...profitMonthly.map(monthCell)],
    flags: flagsFor(data.profit, profitMonthly),
  };

  const rows = [...group("Income", income), ...group("Expenses", expense), profitRow];
  return {
    title: "Budget vs Actual",
    formalTitle: "Budget vs Actual",
    entity: info.entity,
    currency: info.currency,
    periodLine: info.periodLine,
    params: [{ label: "Budget", value: info.budgetName }],
    sections: [{ columns, rows: data.rows.length ? rows : [] }],
    notes: data.rows.length ? ["Variance is actual minus budget. An unfavourable variance is income below budget or expenses above it."] : ["Nothing budgeted or posted for this period."],
    fileBase: "Budget-vs-Actual",
  };
}
