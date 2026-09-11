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
 * Placement: beside the "Balance due" figure, because a pay button parked in
 * the page footer reads as an afterthought. That block moves down the page as
 * line items are added, so its position is FOUND (text extraction via unpdf's
 * serverless pdfjs build) rather than assumed — falling back to the bottom
 * margin, the one region invoice templates reliably leave clear, when the
 * text isn't found.
 *
 * Pure-ish: no db and no QBO knowledge. Callers resolve the URL (see
 * lib/qbo-token.ts's stampQboPayButton) and pass it in.
 */

import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFDict } from "pdf-lib";

const LABEL = "Review and pay online";
/** Most specific first — "balance due" is QBO's wording. */
const ANCHOR_PHRASES = ["balance due", "amount due", "total due"];
/** Gap between the button's right edge and the anchor text. */
const ANCHOR_GAP = 14;
/** Give up on anchoring if the button would be pushed off the left edge. */
const MIN_LEFT_MARGIN = 24;

type Anchor = { pageIndex: number; x: number; baselineY: number; fontSize: number };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Locate the "Balance due" label on any page. Text items come back in the same
 * coordinate space pdf-lib draws in (bottom-left origin, y = baseline) —
 * verified empirically, no viewport transform needed.
 */
async function findAnchor(pdf: Buffer): Promise<Anchor | null> {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(pdf));

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const items = ((await page.getTextContent()).items as any[])
        .filter(i => typeof i.str === "string" && i.str.trim() && Array.isArray(i.transform));

      // Exact hit on a single run — the precise case.
      for (const it of items) {
        if (ANCHOR_PHRASES.some(phrase => norm(it.str).includes(phrase))) {
          return { pageIndex: p - 1, x: it.transform[4], baselineY: it.transform[5], fontSize: it.height || 10 };
        }
      }

      // Otherwise the label may be split across runs ("BALANCE" + "DUE"), so
      // rebuild lines by baseline and match the line. Anchor on the leftmost
      // run of that line, which for a right-aligned totals block is the label.
      const lines = new Map<number, any[]>();
      for (const it of items) {
        const key = Math.round(it.transform[5]);
        const line = lines.get(key);
        if (line) line.push(it);
        else lines.set(key, [it]);
      }
      for (const [, lineItems] of lines) {
        const sorted = lineItems.sort((a, b) => a.transform[4] - b.transform[4]);
        const text = norm(sorted.map(i => i.str).join(" "));
        if (ANCHOR_PHRASES.some(phrase => text.includes(phrase))) {
          const first = sorted[0];
          return { pageIndex: p - 1, x: first.transform[4], baselineY: first.transform[5], fontSize: first.height || 10 };
        }
      }
    }
    return null;
  } catch {
    return null; // extraction is a nicety; never let it break invoice delivery
  }
}

/**
 * Returns the ORIGINAL buffer unchanged if anything about the PDF surprises
 * us: a missing payment button is a disappointment, a corrupted invoice PDF
 * is an incident.
 */
export async function stampPayButtonOnPdf(pdf: Buffer, payUrl: string, label = LABEL): Promise<Buffer> {
  const anchor = await findAnchor(pdf);

  const doc = await PDFDocument.load(pdf);
  const page = doc.getPages()[anchor?.pageIndex ?? 0] ?? doc.getPages()[0];
  if (!page) return pdf;

  // Idempotent: these buffers pass through several layers (fetch → attach →
  // send), so never stack a second button if one is already on the page.
  for (const pg of doc.getPages()) {
    const annots = pg.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const uri = annots.lookup(i, PDFDict)?.lookup(PDFName.of("A"), PDFDict)?.get(PDFName.of("URI"));
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

  let x: number;
  let y: number;
  if (anchor && anchor.x - ANCHOR_GAP - btnW >= MIN_LEFT_MARGIN) {
    // Sit immediately left of "Balance due", vertically centred on that text.
    x = anchor.x - ANCHOR_GAP - btnW;
    y = anchor.baselineY + anchor.fontSize * 0.35 - btnH / 2;
  } else {
    x = (width - btnW) / 2;
    y = 26;
  }

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
