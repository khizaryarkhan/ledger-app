/**
 * Wraps the SAME sheet component the browser-print pages use
 * (components/print-document-sheet.tsx's PrintSheetBody) in a minimal HTML
 * document, for server-side rendering via lib/pdf/render-html.ts.
 *
 * react-dom/server is imported DYNAMICALLY (inside the function, not a
 * top-level `import ... from`) — Next's App Router build statically flags
 * any module that imports react-dom/server and is reachable from a Route
 * Handler ("You're importing a component that imports react-dom/server"),
 * regardless of whether a "use client" boundary is involved at all; this is
 * what actually failed a real deploy. A dynamic import() doesn't appear in
 * that static trace. PrintSheetBody itself still has no "use client"
 * directive and no interactive elements, so nothing else about this split
 * changes — one template, two consumers.
 */
import type { PrintDocument } from "@/lib/accounting/document-print";

export async function renderDocumentHtml(data: PrintDocument): Promise<string> {
  const [{ renderToStaticMarkup }, React, { PrintSheetBody }] = await Promise.all([
    import("react-dom/server"),
    import("react"),
    import("@/components/print-document-sheet"),
  ]);
  const body = renderToStaticMarkup(React.createElement(PrintSheetBody, { data }));
  return `<!doctype html><html><head><meta charset="utf-8" /></head><body>${body}</body></html>`;
}
