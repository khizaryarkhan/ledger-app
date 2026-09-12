/**
 * Stamping QBO's pay button onto an invoice PDF.
 *
 * This mutates a document that goes to the customer's customers, so the
 * failure modes matter more than the feature: a corrupted invoice PDF is an
 * incident, a missing button is a disappointment. These lock in that ordering.
 */
import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts, PDFName, PDFArray, PDFDict, PDFString } from "pdf-lib";
import { stampPayButtonOnPdf } from "@/lib/qbo-pay-button";

const PAY = "https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-test";

/** An invoice-shaped PDF whose totals block sits at a known height. */
async function invoicePdf(lineCount: number, label = "BALANCE DUE"): Promise<{ pdf: Buffer; balanceY: number }> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText("ACME Consulting", { x: 40, y: 740, size: 18, font: bold });
  let y = 650;
  for (let i = 0; i < lineCount; i++) { page.drawText(`Item ${i + 1}`, { x: 40, y, size: 10, font }); y -= 16; }
  y -= 30;
  page.drawText(label, { x: 400, y, size: 11, font: bold });
  page.drawText("US$70.00", { x: 500, y, size: 11, font: bold });
  return { pdf: Buffer.from(await doc.save()), balanceY: y };
}

async function linkAnnotations(pdf: Buffer) {
  const doc = await PDFDocument.load(pdf);
  const out: { uri: string; rect: number[]; page: number }[] = [];
  doc.getPages().forEach((p, idx) => {
    const annots = p.node.lookup(PDFName.of("Annots"), PDFArray);
    if (!annots) return;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i, PDFDict);
      const uri = a?.lookup(PDFName.of("A"), PDFDict)?.get(PDFName.of("URI"));
      const rect = a?.lookup(PDFName.of("Rect"), PDFArray);
      if (uri instanceof PDFString) {
        out.push({
          uri: uri.asString(),
          rect: rect ? rect.asArray().map((n: any) => (typeof n?.asNumber === "function" ? n.asNumber() : Number(String(n)))) : [],
          page: idx,
        });
      }
    }
  });
  return out;
}

describe("stampPayButtonOnPdf", () => {
  it("adds a clickable link carrying the exact pay URL", async () => {
    const { pdf } = await invoicePdf(3);
    const annots = await linkAnnotations(await stampPayButtonOnPdf(pdf, PAY));
    expect(annots).toHaveLength(1);
    expect(annots[0].uri).toBe(PAY);
  });

  it("anchors beside the balance rather than at a fixed spot", async () => {
    // The totals block slides down as line items are added; the button has to
    // follow it, which is the whole reason the position is found not assumed.
    const few = await invoicePdf(2);
    const many = await invoicePdf(20);
    const [aFew] = await linkAnnotations(await stampPayButtonOnPdf(few.pdf, PAY));
    const [aMany] = await linkAnnotations(await stampPayButtonOnPdf(many.pdf, PAY));

    const midY = (r: number[]) => (r[1] + r[3]) / 2;
    expect(midY(aFew.rect)).toBeGreaterThan(midY(aMany.rect));   // it moved down the page
    expect(Math.abs(midY(aFew.rect) - few.balanceY)).toBeLessThan(12);
    expect(Math.abs(midY(aMany.rect) - many.balanceY)).toBeLessThan(12);
    expect(aFew.rect[2]).toBeLessThan(400);                      // right edge sits LEFT of the label
  });

  it("falls back to the bottom margin when there is no balance label", async () => {
    const { pdf } = await invoicePdf(3, "Thank you for your business");
    const [a] = await linkAnnotations(await stampPayButtonOnPdf(pdf, PAY));
    expect(a).toBeDefined();          // a button still appears
    expect(a.rect[1]).toBe(26);       // the documented fallback position
  });

  it("is idempotent — re-stamping never stacks a second button", async () => {
    // These buffers pass through fetch → attach → send, so double-stamping is
    // a real path, not a hypothetical.
    const { pdf } = await invoicePdf(3);
    const once = await stampPayButtonOnPdf(pdf, PAY);
    const twice = await stampPayButtonOnPdf(once, PAY);
    expect(await linkAnnotations(twice)).toHaveLength(1);
  });

  it("rejects unreadable input rather than emitting a broken document", async () => {
    // It throws here on purpose; the caller (stampQboPayButton) catches and
    // serves the untouched PDF, so a bad stamp can never corrupt an invoice.
    await expect(stampPayButtonOnPdf(Buffer.from("this is not a pdf"), PAY)).rejects.toBeTruthy();
  });

  it("keeps the page count unchanged", async () => {
    const { pdf } = await invoicePdf(3);
    const before = (await PDFDocument.load(pdf)).getPageCount();
    const after = (await PDFDocument.load(await stampPayButtonOnPdf(pdf, PAY))).getPageCount();
    expect(after).toBe(before);
  });
});
