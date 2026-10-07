/**
 * GET /api/print/pdf?kind=ledger|trade&id=…
 *
 * The real "Download PDF" counterpart to app/api/print/document/route.ts
 * (which returns JSON for the on-screen browser-print preview at
 * /print/invoice/[id] and /print/trade/[kind]/[id]). This one returns an
 * actual PDF rendered server-side through the one shared engine
 * (lib/pdf/document-pdf.ts) — no browser print dialog, so none of
 * Chrome's own injected header/footer/date-stamp, and no rendering drift
 * between the user's own browser/OS print driver and what was designed.
 */
import { requireOrg, bad } from "@/lib/api";
import { renderLedgerDocumentPdf, renderTradeDocumentPdf } from "@/lib/pdf/document-pdf";

// Headless Chromium (lib/pdf/render-html.ts) cannot run on the Edge runtime.
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const kind = url.searchParams.get("kind") ?? "ledger";
  if (!id) return bad("A document id is required");

  const pdf = kind === "trade"
    ? await renderTradeDocumentPdf(orgId!, id)
    : await renderLedgerDocumentPdf(orgId!, id);
  if (!pdf) return bad("Document not found", 404);

  return new Response(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${kind === "trade" ? "Document" : "Invoice"}.pdf"`,
      "Content-Length": pdf.byteLength.toString(),
      "Cache-Control": "private, max-age=60",
    },
  });
}
