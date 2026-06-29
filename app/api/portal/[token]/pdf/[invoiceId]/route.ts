import { validatePortalToken } from "@/lib/portal";
import { db } from "@/db";
import { invoices, organisations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getOrgQboToken } from "@/lib/qbo-token";
import { getOrgXeroToken } from "@/lib/xero-token";
import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const QBO_API  = "https://quickbooks.api.intuit.com/v3/company";
const XERO_API = "https://api.xero.com/api.xro/2.0";
const TIMEOUT  = 15_000;

function money(n: number | null | undefined, ccy: string) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: ccy || "EUR", maximumFractionDigits: 2 }).format(n);
}

async function generateFallbackPdf(inv: any, orgName: string): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const margin = 50;

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const dark    = rgb(0.06, 0.06, 0.08);
  const mid     = rgb(0.35, 0.35, 0.40);
  const light   = rgb(0.60, 0.60, 0.65);
  const accent  = rgb(0.05, 0.55, 0.37); // emerald

  let y = height - margin;

  // Header bar
  page.drawRectangle({ x: 0, y: y - 14, width, height: 68, color: accent });
  page.drawText("INVOICE", { x: margin, y: y + 36, size: 20, font: bold, color: rgb(1,1,1) });
  const invNo = inv.invoiceNumber || "—";
  page.drawText(`#${invNo}`, { x: width - margin - bold.widthOfTextAtSize(`#${invNo}`, 13), y: y + 38, size: 13, font: bold, color: rgb(1,1,1) });
  page.drawText(orgName, { x: width - margin - regular.widthOfTextAtSize(orgName, 9), y: y + 24, size: 9, font: regular, color: rgb(0.8, 0.95, 0.88) });
  y -= 56;

  const meta: [string, string][] = [
    ["Invoice Date", inv.invoiceDate || "—"],
    ["Due Date",     inv.dueDate     || "—"],
    ["Currency",     inv.currency    || "—"],
    ["Balance Due",  money(inv.balance, inv.currency || "EUR")],
  ];
  for (const [label, value] of meta) {
    page.drawText(label + ":", { x: margin, y, size: 9, font: regular, color: mid });
    page.drawText(value,        { x: margin + 100, y, size: 9, font: regular, color: dark });
    y -= 14;
  }
  y -= 10;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.4, color: rgb(0.85,0.85,0.87) });
  y -= 18;
  page.drawText("This document is generated from your billing system. For a full invoice, please contact " + orgName + ".", { x: margin, y, size: 8, font: regular, color: light });

  return doc.save();
}

export async function GET(req: Request, { params }: { params: { token: string; invoiceId: string } }) {
  const rl = await rateLimit(`portal-pdf:${clientIp(req)}`, 20, 60);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const v = await validatePortalToken(params.token);
  if (!v.ok) return NextResponse.json({ error: "Invalid or expired link" }, { status: 410 });
  const { row } = v;

  const ids = (row.invoiceIds as string[]) ?? [];
  if (!ids.includes(params.invoiceId)) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const [inv] = await db.select().from(invoices)
    .where(and(eq(invoices.id, params.invoiceId), eq(invoices.orgId, row.orgId))).limit(1);
  if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const [org] = await db.select({ name: organisations.name, displayName: organisations.displayName })
    .from(organisations).where(eq(organisations.id, row.orgId)).limit(1);
  const orgName = org?.displayName || org?.name || "Accounts";

  const filename = `Invoice-${inv.invoiceNumber || inv.id}.pdf`;
  const headers  = { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}"`, "Cache-Control": "private, max-age=300" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    // Try Xero
    if (inv.xeroId && !inv.xeroId.startsWith("CN-")) {
      const xt = await getOrgXeroToken(row.orgId).catch(() => null);
      if (xt) {
        const res = await fetch(`${XERO_API}/Invoices/${inv.xeroId}`, {
          headers: { Authorization: `Bearer ${xt.accessToken}`, "Xero-Tenant-Id": xt.tenantId, Accept: "application/pdf" },
          signal: controller.signal,
        });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 0) { clearTimeout(timer); return new Response(buf, { headers }); }
        }
      }
    }

    // Try QBO
    if (inv.qboId && !inv.qboId.startsWith("CM-")) {
      const token = await getOrgQboToken(row.orgId).catch(() => null);
      if (token) {
        const res = await fetch(`${QBO_API}/${token.realmId}/invoice/${inv.qboId}/pdf?minorversion=65`, {
          headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/pdf" },
          signal: controller.signal,
        });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 0) { clearTimeout(timer); return new Response(buf, { headers }); }
        }
      }
    }

    clearTimeout(timer);

    // Fallback: generate minimal PDF
    const balance = inv.qboBalance != null ? Math.max(0, inv.qboBalance) : Math.max(0, (inv.total ?? 0) - (inv.paid ?? 0));
    const pdf = await generateFallbackPdf({ ...inv, balance }, orgName);
    return new Response(pdf as unknown as BodyInit, { headers });
  } catch {
    clearTimeout(timer);
    // Still try fallback PDF rather than failing entirely
    try {
      const balance = inv.qboBalance != null ? Math.max(0, inv.qboBalance) : Math.max(0, (inv.total ?? 0) - (inv.paid ?? 0));
      const pdf = await generateFallbackPdf({ ...inv, balance }, orgName);
      return new Response(pdf as unknown as BodyInit, { headers });
    } catch {
      return NextResponse.json({ error: "PDF unavailable" }, { status: 502 });
    }
  }
}
