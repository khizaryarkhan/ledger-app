/**
 * A report model as an .xlsx workbook, via exceljs (dynamically imported so it
 * never weighs on the app bundle — same approach as lib/export-report.ts).
 *
 * What makes it trustworthy:
 *  - Amounts are real numeric cells, formatted with a number format that keeps
 *    the app's rule: at least 2 decimals, up to 6 (`0.00####`). Totals are the
 *    VALUES the screen showed, not formulas, so the sheet cannot drift from it.
 *  - Dates are written as day serial numbers computed from the literal
 *    YYYY-MM-DD parts. No Date object is ever built, so a date cannot shift a
 *    day with the machine's timezone.
 *  - Strings are written as typed text cells, which Excel never evaluates as
 *    formulas, so a name beginning "=" or "@" cannot execute.
 */
import {
  safeSheetName, exportFileName, EXPORT_LIMITS, totalRows,
  type Cell, type ColumnKind, type ReportExportModel,
} from "./export-model";

export interface ExcelContext {
  orgName: string;
  /** YYYY-MM-DD the report was run. */
  generatedOn: string;
}

const MONEY_FMT = "#,##0.00####;(#,##0.00####)";
const NUM_FORMATS: Record<ColumnKind, string | undefined> = {
  text: undefined,
  money: MONEY_FMT,
  variance: "+#,##0.00####;-#,##0.00####;0.00",
  qty: "General",
  date: "dd mmm yyyy",
  percent: '0.0"%"',
  int: "#,##0",
};

/** Excel's day serial for a literal YYYY-MM-DD (1900 system, epoch 1899-12-30). */
export function excelDateSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30);
  return Math.round(ms / 86400000);
}

function cellValue(kind: ColumnKind, v: Cell): string | number | null {
  if (v == null || v === "") return null;
  if (kind === "date" && typeof v === "string") return excelDateSerial(v) ?? v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  return v;
}

const FONT = "Calibri";

/** Builds the workbook and returns its bytes. Pure apart from loading exceljs. */
export async function buildReportWorkbook(model: ReportExportModel, ctx: ExcelContext): Promise<ArrayBuffer> {
  if (totalRows(model) > EXPORT_LIMITS.excelRows) {
    throw new Error(`This report has more than ${EXPORT_LIMITS.excelRows.toLocaleString()} rows — narrow the filters and export again.`);
  }
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = ctx.orgName || "Prime Accountax";
  const ws = wb.addWorksheet(safeSheetName(model.title));
  const widest = Math.max(1, ...model.sections.map((s) => s.columns.length));
  const widths: number[] = new Array(widest).fill(10);
  const fit = (col: number, text: string) => { widths[col] = Math.max(widths[col], Math.min(60, text.length + 2)); };

  const titleRow = (text: string, size: number, bold: boolean, color?: string) => {
    const r = ws.addRow([text]);
    r.getCell(1).font = { name: FONT, size, bold, ...(color ? { color: { argb: color } } : {}) };
  };
  titleRow(model.entity || ctx.orgName, 14, true);
  titleRow(model.formalTitle || model.title, 12, true);
  if (model.periodLine) titleRow(model.periodLine, 10, false);
  if (model.currency) titleRow(`All amounts in ${model.currency}`, 10, false, "FF78716C");
  for (const p of model.params) titleRow(`${p.label}: ${p.value}`, 10, false, "FF57534E");
  ws.addRow([]);

  let freezeAt: number | null = null;
  model.sections.forEach((s, si) => {
    if (s.heading) {
      const h = ws.addRow([s.heading]);
      h.getCell(1).font = { name: FONT, size: 11, bold: true };
    }
    const head = ws.addRow(s.columns.map((c) => c.label));
    head.eachCell((c, col) => {
      c.font = { name: FONT, bold: true, size: 10 };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F0EE" } };
      c.border = { bottom: { style: "thin" } };
      c.alignment = { horizontal: s.columns[col - 1].kind === "text" || s.columns[col - 1].kind === "date" ? "left" : "right" };
      fit(col - 1, String(c.value ?? ""));
    });
    if (model.sections.length === 1) freezeAt = head.number;

    for (const row of s.rows) {
      if (row.kind === "heading") {
        const r = ws.addRow([row.cells[0] ?? ""]);
        r.getCell(1).font = { name: FONT, size: 10, bold: true, color: { argb: "FF57534E" } };
        continue;
      }
      const r = ws.addRow(s.columns.map((c, i) => cellValue(c.kind, row.cells[i] ?? null)));
      const bold = row.kind !== "line";
      r.eachCell({ includeEmpty: true }, (c, col) => {
        const kind = s.columns[col - 1]?.kind ?? "text";
        const f = NUM_FORMATS[kind];
        if (f && typeof c.value === "number") c.numFmt = f;
        c.font = { name: FONT, size: 10, bold, ...(row.flags?.[col - 1] ? { color: { argb: "FFB91C1C" } } : {}) };
        c.alignment = { horizontal: kind === "text" || kind === "date" ? "left" : "right", indent: col === 1 ? row.indent ?? 0 : 0, vertical: "top" };
        if (row.kind === "subtotal") c.border = { top: { style: "thin" } };
        if (row.kind === "total") c.border = { top: { style: "thin" }, bottom: { style: "double" } };
        fit(col - 1, typeof c.value === "number" ? "00,000,000.00" : String(c.value ?? ""));
      });
    }
    if (si < model.sections.length - 1) ws.addRow([]);
  });

  if (model.notes.length) {
    ws.addRow([]);
    for (const n of model.notes) {
      const r = ws.addRow([n]);
      r.getCell(1).font = { name: FONT, size: 10, italic: true, color: { argb: "FF92400E" } };
    }
  }
  ws.addRow([]);
  const gen = ws.addRow([`Generated ${ctx.generatedOn} from ${ctx.orgName || "Prime Accountax"}`]);
  gen.getCell(1).font = { name: FONT, size: 9, color: { argb: "FF8A8F99" } };

  // A wide first column only where it holds names; a Date or Code column keeps its natural width.
  const firstIsText = model.sections.every((s) => s.columns[0]?.kind === "text" && !/^(date|code)$/.test(s.columns[0].key));
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = i === 0 ? Math.max(w, firstIsText ? 28 : 12) : Math.max(w, 14); });
  // Freeze the header only when the title block above it is short; a long block would leave no room to scroll.
  if (freezeAt && freezeAt <= 8) ws.views = [{ state: "frozen", ySplit: freezeAt }];

  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

/** Browser download. Not unit-tested (needs a DOM); the bytes come from buildReportWorkbook. */
export async function downloadReportExcel(model: ReportExportModel, ctx: ExcelContext): Promise<void> {
  const buf = await buildReportWorkbook(model, ctx);
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileName(model, ctx.generatedOn, "xlsx");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
