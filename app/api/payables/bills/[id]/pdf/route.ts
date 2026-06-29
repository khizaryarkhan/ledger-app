import { db } from "@/db";
import { apBills, apBillLines, apSuppliers } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { eq, and } from "drizzle-orm";
import { getOrgXeroToken } from "@/lib/xero-token";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const XERO_API = "https://api.xero.com/api.xro/2.0";
const PDF_TIMEOUT_MS = 15_000;

// ── Xero native PDF ──────────────────────────────────────────────────────────

async function fetchXeroPdf(xeroId: string, orgId: string): Promise<ArrayBuffer | null> {
  const xt = await getOrgXeroToken(orgId);
  if (!xt) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_TIMEOUT_MS);
  try {
    const res = await fetch(`${XERO_API}/Invoices/${xeroId}`, {
      headers: {
        Authorization: `Bearer ${xt.accessToken}`,
        "Xero-Tenant-Id": xt.tenantId,
        Accept: "application/pdf",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return res.arrayBuffer();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ── Generate PDF from DB data ─────────────────────────────────────────────────

function money(amount: number | null | undefined, currency: string) {
  if (amount == null) return "—";
  const symbol = currency === "GBP" ? "£" : currency === "EUR" ? "€" : "$";
  return `${symbol}${Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

async function generateBillPdf(
  bill: Record<string, any>,
  lines: Record<string, any>[],
  supplier: Record<string, any> | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const margin = 50;
  const cw = width - margin * 2;

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);

  const dark   = rgb(0.06, 0.06, 0.08);
  const mid    = rgb(0.35, 0.35, 0.40);
  const light  = rgb(0.60, 0.60, 0.65);
  const accent = rgb(0.54, 0.36, 0.96); // violet
  const lineC  = rgb(0.87, 0.87, 0.89);
  const bg     = rgb(0.96, 0.96, 0.97);

  let y = height - margin;

  // ── Header bar ───────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: y - 14, width, height: 70, color: accent });
  page.drawText("BILL", { x: margin, y: y + 36, size: 22, font: bold, color: rgb(1, 1, 1) });
  const billNo = bill.billNumber || "No number";
  page.drawText(billNo, {
    x: width - margin - bold.widthOfTextAtSize(billNo, 13),
    y: y + 42, size: 13, font: bold, color: rgb(1, 1, 1),
  });
  const statusLabel = `${bill.accountingStatus || ""}  ·  ${bill.workflowStatus || ""}`;
  page.drawText(statusLabel, {
    x: width - margin - regular.widthOfTextAtSize(statusLabel, 9),
    y: y + 26, size: 9, font: regular, color: rgb(0.9, 0.85, 1),
  });
  y -= 55;

  // ── Two-column: supplier / bill meta ─────────────────────────────────────
  const colW = cw / 2;
  page.drawText("FROM", { x: margin, y, size: 7.5, font: bold, color: light });
  page.drawText("BILL DETAILS", { x: margin + colW, y, size: 7.5, font: bold, color: light });
  y -= 14;

  const supplierName = supplier?.name || bill.supplierName || "Unknown Supplier";
  page.drawText(supplierName, { x: margin, y, size: 11, font: bold, color: dark });
  y -= 15;
  if (supplier?.email) {
    page.drawText(supplier.email, { x: margin, y, size: 9, font: regular, color: mid });
    y -= 13;
  }

  // Bill meta (right column)
  const metaY0 = y + 28;
  const rows = [
    ["Bill #", billNo],
    ["Bill Date", fmtDate(bill.billDate)],
    ["Due Date", fmtDate(bill.dueDate)],
    ["Currency", bill.currency || "GBP"],
    ["Source", bill.source || "Manual"],
  ];
  let metaY = metaY0;
  for (const [label, value] of rows) {
    page.drawText(label, { x: margin + colW, y: metaY, size: 8.5, font: regular, color: light });
    page.drawText(String(value), {
      x: margin + colW + 70,
      y: metaY, size: 8.5, font: regular, color: dark,
    });
    metaY -= 13;
  }

  y = Math.min(y, metaY) - 18;

  // ── Divider ───────────────────────────────────────────────────────────────
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: lineC });
  y -= 18;

  // ── Line Items table ──────────────────────────────────────────────────────
  page.drawText("LINE ITEMS", { x: margin, y, size: 7.5, font: bold, color: light });
  y -= 6;

  // 7 columns: Description | Qty | Unit Price | Account | Ex.Tax | Tax | Inc.Tax
  const cols = [
    { label: "Description", x: margin,              w: cw * 0.32, right: false },
    { label: "Qty",          x: margin + cw * 0.32, w: cw * 0.06, right: true  },
    { label: "Unit Price",   x: margin + cw * 0.38, w: cw * 0.12, right: true  },
    { label: "Account",      x: margin + cw * 0.51, w: cw * 0.13, right: false },
    { label: "Ex. Tax",      x: margin + cw * 0.65, w: cw * 0.11, right: true  },
    { label: "Tax",          x: margin + cw * 0.77, w: cw * 0.10, right: true  },
    { label: "Inc. Tax",     x: margin + cw * 0.88, w: cw * 0.12, right: true  },
  ];

  const rowH = 18;
  page.drawRectangle({ x: margin - 4, y: y - rowH + 4, width: cw + 8, height: rowH, color: bg });
  for (const col of cols) {
    const lx = col.right
      ? col.x + col.w - bold.widthOfTextAtSize(col.label, 7.5)
      : col.x;
    page.drawText(col.label, { x: lx, y: y - 10, size: 7.5, font: bold, color: mid });
  }
  y -= rowH;

  // Data rows — QBO stores tax at bill level not per line; prorate across lines
  const ccy = bill.currency || "GBP";
  const totalSub = lines.reduce((a: number, l: any) => a + (l.lineSubtotal ?? 0), 0);
  const billTaxTotal = bill.taxTotal ?? 0;
  const getLineTax = (l: any) => {
    if ((l.lineTax ?? 0) > 0) return l.lineTax;
    if (!billTaxTotal || totalSub === 0) return 0;
    return billTaxTotal * ((l.lineSubtotal ?? 0) / totalSub);
  };

  for (const line of lines) {
    const desc   = truncate(line.description || "—", 36);
    const qty    = String(line.quantity ?? 1);
    const up     = money(line.unitPrice, ccy);
    const acct   = truncate(line.accountId || "—", 14);
    const exTax  = money(line.lineSubtotal, ccy);
    const lineTax = getLineTax(line);
    const tax    = money(lineTax, ccy);
    const incTax = money((line.lineSubtotal ?? 0) + lineTax, ccy);

    const cells = [
      { text: desc,   col: cols[0] },
      { text: qty,    col: cols[1] },
      { text: up,     col: cols[2] },
      { text: acct,   col: cols[3] },
      { text: exTax,  col: cols[4] },
      { text: tax,    col: cols[5] },
      { text: incTax, col: cols[6] },
    ];

    page.drawLine({ start: { x: margin - 4, y }, end: { x: width - margin + 4, y }, thickness: 0.3, color: lineC });

    for (const { text, col } of cells) {
      const tx = (col as any).right
        ? col.x + col.w - regular.widthOfTextAtSize(text, 8.5)
        : col.x;
      page.drawText(text, { x: tx, y: y - 12, size: 8.5, font: regular, color: dark });
    }
    y -= rowH;

    // New page if needed
    if (y < 100) {
      // simplification: cut off (very long bills uncommon)
      page.drawText("(table continues…)", { x: margin, y, size: 8, font: regular, color: light });
      break;
    }
  }

  // Table bottom border
  page.drawLine({ start: { x: margin - 4, y }, end: { x: width - margin + 4, y }, thickness: 0.5, color: lineC });
  y -= 20;

  // ── Totals block ──────────────────────────────────────────────────────────
  const totW  = 200;
  const totX  = width - margin - totW;
  const totRows: [string, string, boolean?][] = [
    ["Subtotal", money(bill.subtotal, ccy)],
    ["Tax",      money(bill.taxTotal, ccy)],
    ["Total",    money(bill.total, ccy), true],
    ["Paid",     money(bill.amountPaid ?? 0, ccy)],
    ["Balance",  money(bill.balance, ccy), true],
  ];

  for (const [label, value, isBold] of totRows) {
    if (isBold) {
      page.drawLine({ start: { x: totX, y }, end: { x: width - margin, y }, thickness: 0.4, color: lineC });
      y -= 4;
    }
    page.drawText(label, { x: totX, y: y - 11, size: isBold ? 9.5 : 8.5, font: isBold ? bold : regular, color: isBold ? dark : mid });
    page.drawText(value, {
      x: width - margin - regular.widthOfTextAtSize(value, isBold ? 9.5 : 8.5),
      y: y - 11, size: isBold ? 9.5 : 8.5, font: isBold ? bold : regular, color: isBold ? dark : mid,
    });
    y -= isBold ? 18 : 14;
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const footerY = 28;
  page.drawLine({ start: { x: margin, y: footerY + 14 }, end: { x: width - margin, y: footerY + 14 }, thickness: 0.3, color: lineC });
  const generated = `Generated ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
  page.drawText(generated, { x: margin, y: footerY, size: 7.5, font: regular, color: light });

  return doc.save();
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [bill] = await db.select().from(apBills)
    .where(and(eq(apBills.id, params.id), eq(apBills.orgId, orgId!)))
    .limit(1);
  if (!bill) return bad("Bill not found", 404);

  const lines = await db.select().from(apBillLines)
    .where(eq(apBillLines.billId, params.id))
    .orderBy(apBillLines.lineNumber);

  let supplier = null;
  if (bill.supplierId) {
    const [s] = await db.select().from(apSuppliers)
      .where(and(eq(apSuppliers.id, bill.supplierId), eq(apSuppliers.orgId, orgId!)))
      .limit(1);
    supplier = s ?? null;
  }

  // Xero supports PDF download for ACCPAY invoices
  if (bill.xeroId) {
    const xeroPdf = await fetchXeroPdf(bill.xeroId, orgId!);
    if (xeroPdf && xeroPdf.byteLength > 0) {
      return new Response(xeroPdf, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="Bill-${bill.billNumber ?? bill.id}.pdf"`,
          "Content-Length": xeroPdf.byteLength.toString(),
          "Cache-Control": "private, max-age=300",
        },
      });
    }
  }

  // QBO does not support bill PDF via API — generate from our data
  try {
    const pdfBytes = await generateBillPdf(bill, lines, supplier);
    return new Response(pdfBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Bill-${bill.billNumber ?? bill.id}.pdf"`,
        "Content-Length": pdfBytes.byteLength.toString(),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e: any) {
    console.error("Bill PDF generation error:", e);
    return bad("Failed to generate PDF", 500);
  }
}
