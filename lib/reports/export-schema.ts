/**
 * Validation for a report model arriving at the server (PDF route).
 * The browser is not trusted: shape, sizes and cell counts are all checked
 * before anything is rendered.
 */
import { z } from "zod";
import { EXPORT_LIMITS, type ReportExportModel } from "./export-model";

const Cell = z.union([z.string().max(2000), z.number().finite(), z.null()]);

const Column = z.object({
  key: z.string().max(64),
  label: z.string().max(200),
  kind: z.enum(["text", "money", "variance", "qty", "date", "percent", "int"]),
});

const Row = z.object({
  kind: z.enum(["line", "heading", "subtotal", "total"]),
  cells: z.array(Cell).max(EXPORT_LIMITS.maxColumns),
  indent: z.number().int().min(0).max(6).optional(),
  flags: z.array(z.boolean()).max(EXPORT_LIMITS.maxColumns).optional(),
});

const Section = z
  .object({
    heading: z.string().max(200).optional(),
    columns: z.array(Column).min(1).max(EXPORT_LIMITS.maxColumns),
    rows: z.array(Row).max(EXPORT_LIMITS.pdfRows),
  })
  .refine((s) => s.rows.every((r) => r.cells.length === s.columns.length), {
    message: "Every row needs one cell per column",
  });

export const ReportExportModelSchema = z
  .object({
    title: z.string().min(1).max(200),
    formalTitle: z.string().max(200).optional(),
    entity: z.string().max(300),
    currency: z.string().max(8).nullable(),
    periodLine: z.string().max(300).optional(),
    params: z.array(z.object({ label: z.string().max(100), value: z.string().max(500) })).max(40),
    sections: z.array(Section).min(1).max(EXPORT_LIMITS.maxSections),
    notes: z.array(z.string().max(600)).max(30),
    fileBase: z.string().min(1).max(120),
  })
  .refine((m) => m.sections.reduce((n, s) => n + s.rows.length, 0) <= EXPORT_LIMITS.pdfRows, {
    message: `A PDF holds at most ${EXPORT_LIMITS.pdfRows} rows — use Excel for a report this long`,
  });

export function parseReportModel(input: unknown): { ok: true; model: ReportExportModel } | { ok: false; error: string } {
  const r = ReportExportModelSchema.safeParse(input);
  if (r.success) return { ok: true, model: r.data as ReportExportModel };
  return { ok: false, error: r.error.issues[0]?.message || "Invalid report" };
}
