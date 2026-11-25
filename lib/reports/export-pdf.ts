/**
 * A report model as a PDF — SERVER-ONLY (headless Chromium). The HTML is the
 * same pure document the Print button shows (export-html.ts); the engine is the
 * one shared choke point, lib/pdf/render-html.ts. Never import this from a
 * "use client" file.
 */
import { renderHtmlToPdf } from "@/lib/pdf/render-html";
import { buildReportHtml, type ReportHtmlContext } from "./export-html";
import type { ReportExportModel } from "./export-model";

export async function renderReportPdf(model: ReportExportModel, ctx: ReportHtmlContext): Promise<Buffer> {
  const { html, footerTemplate } = buildReportHtml(model, ctx);
  return renderHtmlToPdf(html, { footerTemplate });
}
