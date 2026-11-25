/**
 * Shared shape for the purchasing / sales list reports (open orders, goods
 * awaiting a bill or invoice, open bills / invoices): one table of the rows the
 * screen shows after the user's sort and filters, and the screen's own total.
 * PURE — no Date, no clock.
 */
import { num, type Cell, type ExportColumn, type ExportRow, type ReportExportModel } from "../export-model";

export interface TradeInfo {
  entity: string;
  currency: string | null;
}

export interface TradeSpec {
  title: string;
  fileBase: string;
  /** What the rows are called in the filtered-view note, e.g. "purchase orders". */
  noun: string;
  columns: ExportColumn[];
  /** The label printed on the total row (the screen's footer label). */
  totalLabel: string;
  /** Index of the column that carries the total. */
  totalCol: number;
  /** One row's cells, in column order. */
  cells: (r: any) => Cell[];
  /** Optional per-row exception flags, one per column. */
  flags?: (r: any) => boolean[];
}

/** A literal calendar date or null; a timestamp at midnight keeps its date part. */
export function dateCell(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}(?:$|T00:00:00)/.test(v) ? v.slice(0, 10) : null;
}

export function textCell(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function buildTradeModel(data: any, shownRows: any[], info: TradeInfo, spec: TradeSpec): ReportExportModel {
  const all: any[] = data?.rows ?? [];
  const rows: ExportRow[] = shownRows.map((r): ExportRow => {
    const row: ExportRow = { kind: "line", cells: spec.cells(r) };
    const flags = spec.flags?.(r);
    if (flags && flags.some(Boolean)) row.flags = flags;
    return row;
  });
  // The screen hides its footer when nothing is listed; so does the export.
  if (rows.length > 0) {
    const cells: Cell[] = spec.columns.map(() => null);
    cells[0] = spec.totalLabel;
    cells[spec.totalCol] = num(data?.total);
    rows.push({ kind: "total", cells });
  }
  const notes: string[] = [];
  if (shownRows.length !== all.length) {
    notes.push(`Filtered view: ${shownRows.length} of ${all.length} ${spec.noun} are listed. The total is for all ${all.length}.`);
  }
  return {
    title: spec.title,
    formalTitle: spec.title,
    entity: info.entity,
    currency: info.currency,
    params: [],
    sections: [{ columns: spec.columns, rows }],
    notes,
    fileBase: spec.fileBase,
  };
}

/** True when a fetched response must not be exported (still loading, failed, or an error body). */
export function tradeDataUnusable(data: any): boolean {
  return data === null || data === undefined || !!data.failed || !!data.error || !Array.isArray(data.rows);
}
