"use client";

/**
 * The printed business document — one template for every outbound document
 * (Invoice, Bill, Credit note, Quote, Purchase Order, Sales Order).
 *
 * This is now a thin client wrapper: the actual sheet markup/CSS lives in
 * components/print-document-sheet.tsx (PrintSheetBody), which has NO
 * "use client" directive, because lib/pdf/render-document.tsx needs to
 * render-to-static-markup it for the server PDF engine — Next's build
 * refuses to let react-dom/server reach anything inside a "use client"
 * module. This file adds only the interactive Close/Print bar on top, for
 * the on-screen /print/... pages.
 *
 * Design rationale (unchanged, now documented on PrintSheetBody): brand
 * accent carries the title/table header/balance-due block; BALANCE DUE is
 * the most prominent figure; bill-to/ship-to sit side by side; A4 with a
 * repeating table header and a signature block on authorised documents.
 */

import { PrintSheetBody } from "@/components/print-document-sheet";
import type { PrintDocument } from "@/lib/accounting/document-print";

export function PrintDocumentSheet({ data }: { data: PrintDocument }) {
  return (
    <>
      <div className="bar noprint">
        <button className="btn g" onClick={() => window.close()}>Close</button>
        <button className="btn" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <PrintSheetBody data={data} />
    </>
  );
}
