/**
 * Wraps the SAME sheet component the browser-print pages use
 * (components/print-document.tsx's PrintDocumentSheet) in a minimal HTML
 * document, for server-side rendering via lib/pdf/render-html.ts.
 *
 * The component's own interactive Close/Print bar hides itself under its
 * `@media print` rule; renderHtmlToPdf emulates print media before calling
 * page.pdf(), so that bar never appears in the output. One template, two
 * consumers — a human clicking Print in the browser, and this server path —
 * never two different-looking documents for the same data.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintDocumentSheet } from "@/components/print-document";
import type { PrintDocument } from "@/lib/accounting/document-print";

export function renderDocumentHtml(data: PrintDocument): string {
  const body = renderToStaticMarkup(<PrintDocumentSheet data={data} />);
  return `<!doctype html><html><head><meta charset="utf-8" /></head><body>${body}</body></html>`;
}
