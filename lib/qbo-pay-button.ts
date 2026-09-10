/**
 * Stamp a clickable "Review and pay online" button onto an invoice PDF.
 *
 * Why this exists: customers compared an invoice their accountant sent from
 * QuickBooks (payment link present) against the same invoice sent/downloaded
 * from this app (no link), and it was a deal-breaker. The PDF we serve comes
 * from QBO's own `/invoice/{id}/pdf` export endpoint, and we can't control
 * whether QBO renders its pay button into that export — so rather than depend
 * on QBO's template behaviour, we overlay a real button ourselves, pointing at
 * QBO's own hosted payment page (`Invoice.InvoiceLink`).
 *
 * Pure function — no network, no db, no QBO knowledge. Callers resolve the URL
 * (see lib/qbo-token.ts's stampQboPayButton) and pass it in.
 */

import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFDict } from "pdf-lib";

const LABEL = "Review and pay online";

/**
 * Draws the button in the bottom margin of page 1 — the one area invoice
 * templates reliably leave clear — on an opaque white backdrop so it stays
 * legible even over a faint footer. Returns the ORIGINAL buffer unchanged if
 * anything about the PDF surprises us: a missing payment button is a
 * disappointment, a corrupted invoice PDF is an incident.
 */
export async function stampPayButtonOnPdf(pdf: Buffer, payUrl: string, label = LABEL): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf);
  const page = doc.getPages()[0];
  if (!page) return pdf;

  // Idempotent: these buffers pass through several layers (fetch → attach →
  // send), so never stack a second button if one is already on the page.
  const already = page.node.Annots();
  if (already) {
    for (let i = 0; i < already.size(); i++) {
      const uri = already.lookup(i, PDFDict)?.lookup(PDFName.of("A"), PDFDict)?.get(PDFName.of("URI"));
      if (uri instanceof PDFString && uri.asString() === payUrl) return pdf;
    }
  }

  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width } = page.getSize();

  const size = 10;
  const padX = 14;
  const padY = 8;
  const btnW = font.widthOfTextAtSize(label, size) + padX * 2;
  const btnH = size + padY * 2;
  const x = (width - btnW) / 2;
  const y = 26;

  page.drawRectangle({ x: x - 6, y: y - 6, width: btnW + 12, height: btnH + 12, color: rgb(1, 1, 1) });
  page.drawRectangle({ x, y, width: btnW, height: btnH, color: rgb(0.02, 0.6, 0.41) });
  page.drawText(label, { x: x + padX, y: y + padY, size, font, color: rgb(1, 1, 1) });

  // The drawn rectangle is just ink — this annotation is what makes it clickable.
  const annot = doc.context.register(
    doc.context.obj({
      Type:    "Annot",
      Subtype: "Link",
      Rect:    [x, y, x + btnW, y + btnH],
      Border:  [0, 0, 0],
      A:       { Type: "Action", S: "URI", URI: PDFString.of(payUrl) },
    }),
  );
  const existing = page.node.Annots();
  if (existing) existing.push(annot);
  else page.node.set(PDFName.of("Annots"), doc.context.obj([annot]));

  return Buffer.from(await doc.save());
}
