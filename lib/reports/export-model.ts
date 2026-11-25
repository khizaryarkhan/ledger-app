/**
 * The one shape every report is exported through (Excel, PDF, Print).
 *
 * PURE and client-safe — no db, no React, no Date construction. A report page
 * builds one of these from the SAME data object it renders (see
 * lib/reports/builders/*), so the export cannot disagree with the screen.
 * Writers (export-excel.ts, export-html.ts) only ever read this shape.
 *
 * Conventions that keep the exports honest:
 *  - Amounts are NUMBERS, never preformatted strings. Excel gets a real
 *    numeric cell; the PDF formats through lib/format (min 2dp, up to 6).
 *  - Dates are the literal "YYYY-MM-DD" string. Nothing here builds a Date,
 *    so a date can never shift a day with the viewer's timezone.
 *  - A cell the screen leaves blank is null, not 0.
 *  - Currencies are never added together: a report with several currencies
 *    carries one total row per currency, as the screen does.
 */

export type ColumnKind = "text" | "money" | "variance" | "qty" | "date" | "percent" | "int";

export interface ExportColumn {
  key: string;
  label: string;
  kind: ColumnKind;
}

export type RowKind = "line" | "heading" | "subtotal" | "total";

export type Cell = string | number | null;

export interface ExportRow {
  kind: RowKind;
  /** One entry per column of the section, in order. */
  cells: Cell[];
  /** Indent steps for the first column (0–6). */
  indent?: number;
  /** Per cell: true marks an exception the screen colours (e.g. an unfavourable budget variance). */
  flags?: boolean[];
}

export interface ExportSection {
  heading?: string;
  columns: ExportColumn[];
  rows: ExportRow[];
}

export interface ReportExportModel {
  /** The screen title, e.g. "Profit & Loss". */
  title: string;
  /** The formal statement title, e.g. "Statement of Profit or Loss". */
  formalTitle?: string;
  /** Whose figures these are. */
  entity: string;
  /** ISO code the amounts are in; null when each row carries its own. */
  currency: string | null;
  /** "For the period 01 Jul 2026 to 20 Nov 2026" / "As at 20 Nov 2026". */
  periodLine?: string;
  /** The filters and options that produced this view, label → value. */
  params: { label: string; value: string }[];
  sections: ExportSection[];
  /** Warnings the screen shows (truncation, out of balance, estimates). */
  notes: string[];
  /** File name without extension or date, e.g. "Profit-and-Loss". */
  fileBase: string;
}

/** Limits shared by the PDF route's validation and the writers. */
export const EXPORT_LIMITS = {
  /** A PDF page count beyond this is unreadable; steer the user to Excel. */
  pdfRows: 3000,
  /** Excel handles far more, but a browser-built workbook should stay sane. */
  excelRows: 50000,
  maxColumns: 60,
  maxSections: 40,
} as const;

export function totalRows(model: ReportExportModel): number {
  return model.sections.reduce((n, s) => n + s.rows.length, 0);
}

/** Excel sheet names: ≤31 chars, none of  [ ] : * ? / \ */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(/[\[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "Report").slice(0, 31);
}

/** "Profit-and-Loss_2026-11-20" — never contains path or control characters. */
export function exportFileName(model: ReportExportModel, runDate: string, ext: string): string {
  const base = model.fileBase.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "Report";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(runDate) ? runDate : "";
  return `${base}${day ? `_${day}` : ""}.${ext}`;
}

/** A finite number or null — NaN/Infinity must never reach a spreadsheet cell. */
export function num(n: unknown): number | null {
  if (n == null || n === "") return null;
  const v = typeof n === "number" ? n : Number(n);
  // Rounded to the widest column the database holds (6dp): a computed sum such as 1234.5600000000002 must not reach a cell.
  return Number.isFinite(v) ? Number(v.toFixed(6)) : null;
}

/** Money cell that the screen leaves blank when the amount is effectively zero. */
export function numOrBlank(n: unknown): number | null {
  const v = num(n);
  return v == null || Math.abs(v) < 0.005 ? null : v;
}
