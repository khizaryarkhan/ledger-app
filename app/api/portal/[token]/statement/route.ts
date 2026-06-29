import { validatePortalToken } from "@/lib/portal";
import { db } from "@/db";
import { invoices, customers, organisations } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

function money(n: number | null | undefined, ccy: string) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: ccy || "EUR", maximumFractionDigits: 2 }).format(n);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function isOverdue(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

async function buildStatementPdf(
  orgName: string,
  logoUrl: string | null,
  customerName: string,
  invs: { invoiceNumber: string; invoiceDate: string; dueDate: string; currency: string; balance: number; overdue: boolean }[],
): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const m  = 50;  // margin
  const cw = width - m * 2;

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const dark    = rgb(0.06, 0.06, 0.08);
  const mid     = rgb(0.35, 0.35, 0.40);
  const light   = rgb(0.60, 0.60, 0.65);
  const rose    = rgb(0.86, 0.23, 0.23);
  const emerald = rgb(0.05, 0.55, 0.37);
  const bg      = rgb(0.96, 0.97, 0.96);
  const lineC   = rgb(0.87, 0.87, 0.89);

  let y = height - m;

  // ── Header ────────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: y - 14, width, height: 72, color: rgb(0.07, 0.08, 0.10) });
  page.drawText("ACCOUNT STATEMENT", { x: m, y: y + 38, size: 16, font: bold, color: rgb(1,1,1) });
  page.drawText(orgName, { x: m, y: y + 20, size: 9, font: regular, color: rgb(0.6, 0.6, 0.65) });
  const dateStr = `As of ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`;
  page.drawText(dateStr, { x: width - m - regular.widthOfTextAtSize(dateStr, 9), y: y + 28, size: 9, font: regular, color: rgb(0.55, 0.55, 0.60) });
  y -= 60;

  // ── Customer block ────────────────────────────────────────────────────────
  page.drawText("TO", { x: m, y, size: 7.5, font: bold, color: light });
  y -= 14;
  page.drawText(customerName, { x: m, y, size: 12, font: bold, color: dark });
  y -= 20;

  // ── Summary box ───────────────────────────────────────────────────────────
  const currency = invs[0]?.currency || "EUR";
  const totalBalance   = invs.reduce((s, i) => s + i.balance, 0);
  const overdueBalance = invs.filter(i => i.overdue).reduce((s, i) => s + i.balance, 0);

  page.drawRectangle({ x: m, y: y - 44, width: cw, height: 54, color: bg });
  const boxY = y - 14;
  page.drawText("Total Outstanding", { x: m + 12, y: boxY + 14, size: 8, font: regular, color: mid });
  page.drawText(money(totalBalance, currency), { x: m + 12, y: boxY, size: 14, font: bold, color: dark });
  if (overdueBalance > 0) {
    const label = `${money(overdueBalance, currency)} overdue`;
    page.drawText(label, { x: width - m - 12 - regular.widthOfTextAtSize(label, 8), y: boxY + 14, size: 8, font: regular, color: mid });
    page.drawText("Requires immediate attention", { x: width - m - 12 - regular.widthOfTextAtSize("Requires immediate attention", 8), y: boxY, size: 8, font: regular, color: rose });
  }
  y -= 62;

  // ── Table header ─────────────────────────────────────────────────────────
  const cols = [
    { label: "Invoice #",    x: m,               w: cw * 0.20, right: false },
    { label: "Invoice Date", x: m + cw * 0.20,   w: cw * 0.18, right: false },
    { label: "Due Date",     x: m + cw * 0.38,   w: cw * 0.18, right: false },
    { label: "Status",       x: m + cw * 0.56,   w: cw * 0.16, right: false },
    { label: "Balance Due",  x: m + cw * 0.72,   w: cw * 0.28, right: true  },
  ];
  const rowH = 20;

  page.drawRectangle({ x: m - 4, y: y - rowH + 4, width: cw + 8, height: rowH, color: rgb(0.1, 0.11, 0.13) });
  for (const col of cols) {
    const lx = col.right ? col.x + col.w - bold.widthOfTextAtSize(col.label, 7.5) : col.x;
    page.drawText(col.label, { x: lx, y: y - 12, size: 7.5, font: bold, color: rgb(1,1,1) });
  }
  y -= rowH;

  // ── Data rows ─────────────────────────────────────────────────────────────
  for (const inv of invs) {
    page.drawLine({ start: { x: m - 4, y }, end: { x: width - m + 4, y }, thickness: 0.3, color: lineC });
    const cells = [
      { text: `#${inv.invoiceNumber}`, col: cols[0] },
      { text: fmtDate(inv.invoiceDate), col: cols[1] },
      { text: fmtDate(inv.dueDate),     col: cols[2] },
      { text: inv.overdue ? "OVERDUE" : "Outstanding", col: cols[3] },
      { text: money(inv.balance, inv.currency), col: cols[4] },
    ];
    for (const { text, col } of cells) {
      const tx = col.right ? col.x + col.w - regular.widthOfTextAtSize(text, 8.5) : col.x;
      const isOverdueCol = col.label === "Status" && inv.overdue;
      page.drawText(text, { x: tx, y: y - 13, size: 8.5, font: isOverdueCol ? bold : regular, color: isOverdueCol ? rose : dark });
    }
    y -= rowH;
    if (y < 120) { page.drawText("(continued on next page)", { x: m, y, size: 8, font: regular, color: light }); break; }
  }

  // ── Total row ─────────────────────────────────────────────────────────────
  page.drawLine({ start: { x: m - 4, y }, end: { x: width - m + 4, y }, thickness: 0.5, color: lineC });
  y -= 4;
  const totalLabel = "TOTAL DUE";
  const totalValue = money(totalBalance, currency);
  page.drawText(totalLabel, { x: m, y: y - 13, size: 9.5, font: bold, color: dark });
  page.drawText(totalValue, { x: width - m - bold.widthOfTextAtSize(totalValue, 11), y: y - 14, size: 11, font: bold, color: emerald });
  y -= 30;

  // ── Footer ────────────────────────────────────────────────────────────────
  const footerY = 34;
  page.drawLine({ start: { x: m, y: footerY + 16 }, end: { x: width - m, y: footerY + 16 }, thickness: 0.3, color: lineC });
  page.drawText(`Statement generated by ${orgName}`, { x: m, y: footerY, size: 7.5, font: regular, color: light });
  const rightNote = `Generated ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
  page.drawText(rightNote, { x: width - m - regular.widthOfTextAtSize(rightNote, 7.5), y: footerY, size: 7.5, font: regular, color: light });

  return doc.save();
}

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const rl = await rateLimit(`portal-stmt:${clientIp(req)}`, 10, 60);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const v = await validatePortalToken(params.token);
  if (!v.ok) return NextResponse.json({ error: "Invalid or expired link" }, { status: 410 });
  const { row } = v;

  const [org] = await db.select({ name: organisations.name, displayName: organisations.displayName, logoUrl: organisations.logoUrl, currency: organisations.currency })
    .from(organisations).where(eq(organisations.id, row.orgId)).limit(1);
  const [cust] = await db.select({ name: customers.name })
    .from(customers).where(eq(customers.id, row.customerId)).limit(1);

  const ids = (row.invoiceIds as string[]) ?? [];
  const invRows = ids.length > 0
    ? await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, invoiceDate: invoices.invoiceDate, dueDate: invoices.dueDate, currency: invoices.currency, total: invoices.total, paid: invoices.paid, qboBalance: invoices.qboBalance, paymentStatus: invoices.paymentStatus })
        .from(invoices).where(and(eq(invoices.orgId, row.orgId), eq(invoices.customerId, row.customerId), inArray(invoices.id, ids)))
    : [];

  const open = invRows
    .filter(i => i.paymentStatus !== "Paid")
    .map(i => ({
      invoiceNumber: i.invoiceNumber || i.id.slice(0, 8),
      invoiceDate: i.invoiceDate || "",
      dueDate: i.dueDate || "",
      currency: i.currency || org?.currency || "EUR",
      balance: i.qboBalance != null ? Math.max(0, i.qboBalance) : Math.max(0, (i.total ?? 0) - (i.paid ?? 0)),
      overdue: isOverdue(i.dueDate),
    }));

  if (open.length === 0) return NextResponse.json({ error: "No open invoices" }, { status: 404 });

  const orgName      = org?.displayName || org?.name || "Accounts";
  const customerName = cust?.name ?? "Customer";

  const pdf = await buildStatementPdf(orgName, org?.logoUrl ?? null, customerName, open);
  const filename = `Statement-${customerName.replace(/[^a-zA-Z0-9]/g, "-")}.pdf`;

  return new Response(pdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
