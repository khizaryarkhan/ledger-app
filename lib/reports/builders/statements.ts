/**
 * Financial statements → export model. PURE: each function reads the SAME
 * response object the statement page renders (GET /api/financials), applying
 * the same display rules the screen applies (a line that nets to zero is not
 * shown; a multi-column cell that is exactly 0 is blank). Totals are the
 * response's own figures, never recomputed except where the screen recomputes.
 */
import { fmt } from "@/lib/format";
import { num, type ExportColumn, type ExportRow, type ReportExportModel } from "../export-model";

export interface StatementInfo {
  title: string;
  formalTitle: string;
  entity: string;
  currency: string | null;
  periodLine: string;
  params: { label: string; value: string }[];
  fileBase: string;
}

type Line = { name: string; amount: number };

const shown = (l: Line) => Math.abs(Number(l.amount) || 0) >= 0.005;
const sum = (lines: Line[]) => lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

const TEXT = (key: string, label: string): ExportColumn => ({ key, label, kind: "text" });
const MONEY = (key: string, label: string): ExportColumn => ({ key, label, kind: "money" });

const heading = (label: string, width: number): ExportRow => ({ kind: "heading", cells: [label, ...Array(width - 1).fill(null)] });

/** A titled block of lines with its total — the screen's <Section>. */
function block(title: string, lines: Line[], total: number): ExportRow[] {
  return [
    heading(title, 2),
    ...lines.filter(shown).map((l): ExportRow => ({ kind: "line", indent: 1, cells: [l.name, num(l.amount)] })),
    { kind: "subtotal", cells: [`Total ${title}`, num(total)] },
  ];
}

const sub = (label: string, v: number): ExportRow => ({ kind: "subtotal", cells: [label, num(v)] });
const grand = (label: string, v: number): ExportRow => ({ kind: "total", cells: [label, num(v)] });

function model(info: StatementInfo, columns: ExportColumn[], rows: ExportRow[], notes: string[] = []): ReportExportModel {
  return {
    title: info.title,
    formalTitle: info.formalTitle,
    entity: info.entity,
    currency: info.currency,
    periodLine: info.periodLine,
    params: info.params,
    sections: [{ columns, rows }],
    notes,
    fileBase: info.fileBase,
  };
}

const EMPTY_NOTE = "No posted ledger entries in this period.";
const AMOUNT_COLS = [TEXT("account", "Account"), MONEY("amount", "Amount")];

// ── Single-column statements ───────────────────────────────────────────────

function plRows(d: any): ExportRow[] {
  const rev = d.sections[0], cos = d.sections[1];
  return [
    ...block("Revenue", rev.lines, rev.total),
    ...block("Cost of Sales", cos.lines, cos.total),
    sub("Gross Profit", d.grossProfit),
    ...block("Other Income", d.otherIncome.lines, d.otherIncome.total),
    ...block("Operating Expenses", d.operatingExpenses.lines, d.operatingExpenses.total),
    ...block("Finance Costs", d.financeCosts.lines, d.financeCosts.total),
    sub("Profit Before Tax", d.profitBeforeTax),
    ...block("Taxation", d.taxation.lines, d.taxation.total),
    grand("Net Profit for the Period", d.netProfit),
  ];
}

export function buildProfitLossModel(d: any, info: StatementInfo): ReportExportModel {
  const hasAny = d.sections[0].lines.length || d.sections[1].lines.length || d.otherIncome.lines.length || d.operatingExpenses.lines.length;
  return hasAny ? model(info, AMOUNT_COLS, plRows(d)) : model(info, AMOUNT_COLS, [], [EMPTY_NOTE]);
}

export function buildComprehensiveIncomeModel(d: any, info: StatementInfo): ReportExportModel {
  const hasAny = d.sections?.[0]?.lines.length || d.sections?.[1]?.lines.length || d.otherIncome.lines.length || d.operatingExpenses.lines.length || d.oci.lines.length;
  if (!hasAny) return model(info, AMOUNT_COLS, [], [EMPTY_NOTE]);
  return model(info, AMOUNT_COLS, [
    ...plRows(d),
    heading("Other Comprehensive Income", 2),
    ...block("Items that will not be reclassified to profit or loss", d.oci.lines, d.oci.total),
    grand("Total Comprehensive Income for the Period", d.totalComprehensiveIncome),
  ]);
}

export function buildBalanceSheetModel(d: any, info: StatementInfo): ReportExportModel {
  const hasProvisions = Boolean(d.provisions && (d.provisions.nonCurrent.length || d.provisions.current.length));
  const rows: ExportRow[] = [
    heading("Assets", 2),
    ...block("Non-current Assets", d.assets.nonCurrent, sum(d.assets.nonCurrent)),
    ...block("Current Assets", d.assets.current, sum(d.assets.current)),
    sub("Total Assets", d.assets.total),
    heading("Equity & Liabilities", 2),
    ...block("Equity", d.equity.lines, d.equity.total),
    ...block("Non-current Liabilities", d.liabilities.nonCurrent, sum(d.liabilities.nonCurrent)),
    ...block("Current Liabilities", d.liabilities.current, sum(d.liabilities.current)),
    ...(hasProvisions ? [
      ...block("Non-current Provisions", d.provisions.nonCurrent, sum(d.provisions.nonCurrent)),
      ...block("Current Provisions", d.provisions.current, sum(d.provisions.current)),
    ] : []),
    grand("Total Equity & Liabilities", d.totalEquityAndLiabilities),
  ];
  return model(info, AMOUNT_COLS, rows, d.balanced ? [] : ["Does not balance — assets ≠ equity + liabilities."]);
}

export function buildTrialBalanceModel(d: any, info: StatementInfo): ReportExportModel {
  const cols: ExportColumn[] = [TEXT("code", "Code"), TEXT("account", "Account"), MONEY("debit", "Debit"), MONEY("credit", "Credit")];
  if (!d.rows.length) return model(info, cols, [], [EMPTY_NOTE]);
  const rows: ExportRow[] = d.rows.map((r: any): ExportRow => ({
    kind: "line",
    cells: [r.code ?? null, r.name, r.debit ? num(r.debit) : null, r.credit ? num(r.credit) : null],
  }));
  rows.push({ kind: "total", cells: [null, "Total", num(d.totalDebit), num(d.totalCredit)] });
  const gap = d.totalDebit - d.totalCredit;
  const notes = d.balanced ? [] : [`Out of balance by ${gap < 0 ? `(${fmt.num2(Math.abs(gap))})` : fmt.num2(gap)} — a ledger integrity issue.`];
  return model(info, cols, rows, notes);
}

export function buildChangesInEquityModel(d: any, info: StatementInfo): ReportExportModel {
  const cols: ExportColumn[] = [TEXT("category", "Category"), MONEY("opening", "Opening"), MONEY("movement", "Movement"), MONEY("closing", "Closing")];
  if (!d.rows?.length) return model(info, cols, [], [EMPTY_NOTE]);
  const rows: ExportRow[] = d.rows.map((r: any): ExportRow => ({
    kind: "line",
    cells: [r.label, num(r.opening), num(r.movement), num(r.closing)],
  }));
  rows.push({ kind: "total", cells: ["Total", num(d.totalOpening), num(d.totalMovement), num(d.totalClosing)] });
  return model(info, cols, rows);
}

// ── Multi-column (Display columns by / Compare to) ─────────────────────────

type MRow = { name: string; values: number[] };
type MBlock = { rows: MRow[]; totals: number[] };

const cellOf = (v: number) => (v === 0 ? null : num(v));

function mblock(title: string, b: MBlock, width: number): ExportRow[] {
  return [
    heading(title, width),
    ...b.rows.map((r): ExportRow => ({ kind: "line", indent: 1, cells: [r.name, ...r.values.map(cellOf)] })),
    { kind: "subtotal", cells: [`Total ${title}`, ...b.totals.map(num)] },
  ];
}
const msub = (label: string, v: number[]): ExportRow => ({ kind: "subtotal", cells: [label, ...v.map(num)] });
const mgrand = (label: string, v: number[]): ExportRow => ({ kind: "total", cells: [label, ...v.map(num)] });

function mcols(table: any): ExportColumn[] {
  return [TEXT("account", "Account"), ...table.columns.map((c: any): ExportColumn => MONEY(c.key, c.label))];
}

export function buildMultiProfitLossModel(t: any, info: StatementInfo): ReportExportModel {
  const w = t.columns.length + 1;
  const rows: ExportRow[] = [
    ...mblock("Revenue", t.revenue, w),
    ...mblock("Cost of Sales", t.costOfSales, w),
    msub("Gross Profit", t.grossProfit),
    ...mblock("Other Income", t.otherIncome, w),
    ...mblock("Operating Expenses", t.operatingExpenses, w),
    ...mblock("Finance Costs", t.financeCosts, w),
    msub("Profit Before Tax", t.profitBeforeTax),
    ...mblock("Taxation", t.taxation, w),
    mgrand("Net Profit for the Period", t.netProfit),
  ];
  return model(info, mcols(t), rows);
}

export function buildMultiBalanceSheetModel(t: any, info: StatementInfo): ReportExportModel {
  const w = t.columns.length + 1;
  const rows: ExportRow[] = [
    heading("Assets", w),
    ...mblock("Non-current Assets", t.assets.nonCurrent, w),
    ...mblock("Current Assets", t.assets.current, w),
    msub("Total Assets", t.assets.total),
    heading("Equity & Liabilities", w),
    ...mblock("Equity", t.equity, w),
    ...mblock("Non-current Liabilities", t.liabilities.nonCurrent, w),
    ...mblock("Current Liabilities", t.liabilities.current, w),
    mgrand("Total Equity & Liabilities", t.totalEquityAndLiabilities),
  ];
  return model(info, mcols(t), rows);
}

/** Dispatch by statement slug; `multi` selects the column-engine variants. */
export function buildStatementModel(statement: string, data: any, info: StatementInfo, multi: boolean): ReportExportModel {
  if (multi && statement === "profit-loss") return buildMultiProfitLossModel(data.table, info);
  if (multi && statement === "balance-sheet") return buildMultiBalanceSheetModel(data.table, info);
  switch (statement) {
    case "profit-loss": return buildProfitLossModel(data, info);
    case "comprehensive-income": return buildComprehensiveIncomeModel(data, info);
    case "changes-in-equity": return buildChangesInEquityModel(data, info);
    case "balance-sheet": return buildBalanceSheetModel(data, info);
    default: return buildTrialBalanceModel(data, info);
  }
}
