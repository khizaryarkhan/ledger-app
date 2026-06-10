import { NextRequest, NextResponse } from "next/server";
import { requireOrg } from "@/lib/api";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { fetchQboInvoicePdf } from "@/lib/qbo-token";
import { getOrgXeroToken } from "@/lib/xero-token";
import JSZip from "jszip";

const XERO_API = "https://api.xero.com/api.xro/2.0";

// POST /api/invoices/download-pdfs
// Body: { invoiceIds: string[] }
// Returns: single PDF (1 invoice) or ZIP (multiple)
export async function POST(req: NextRequest) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const { invoiceIds } = await req.json();
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    return NextResponse.json({ error: "invoiceIds required" }, { status: 400 });
  }
  if (invoiceIds.length > 50) {
    return NextResponse.json({ error: "Maximum 50 invoices at a time" }, { status: 400 });
  }

  // Fetch invoice rows (org-scoped for multi-tenant safety)
  const rows = await db
    .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, qboId: invoices.qboId, xeroId: invoices.xeroId })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId!), inArray(invoices.id, invoiceIds)));

  if (rows.length === 0) {
    return NextResponse.json({ error: "No invoices found" }, { status: 404 });
  }

  // If any invoice came from Xero, get a Xero token once (reused across all).
  const needsXero = rows.some((r) => r.xeroId && !r.xeroId.startsWith("CN-"));
  let xeroToken: Awaited<ReturnType<typeof getOrgXeroToken>> | null = null;
  if (needsXero) {
    try { xeroToken = await getOrgXeroToken(orgId!); } catch { xeroToken = null; }
  }

  // Provider-aware PDF fetch — Xero invoices pull from Xero, the rest from QBO.
  async function fetchPdf(inv: (typeof rows)[0]): Promise<Buffer | null> {
    if (inv.xeroId && !inv.xeroId.startsWith("CN-")) {
      if (!xeroToken) return null;
      try {
        const res = await fetch(`${XERO_API}/Invoices/${inv.xeroId}`, {
          headers: {
            Authorization: `Bearer ${xeroToken.accessToken}`,
            "Xero-Tenant-Id": xeroToken.tenantId,
            Accept: "application/pdf",
          },
        });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        return buf.byteLength > 0 ? buf : null;
      } catch {
        return null;
      }
    }
    return await fetchQboInvoicePdf(orgId!, { qboId: inv.qboId, invoiceNumber: inv.invoiceNumber });
  }

  // Fetch PDFs in parallel (max 5 concurrent)
  const results: { inv: typeof rows[0]; pdf: Buffer | null }[] = [];
  const chunks = [];
  for (let i = 0; i < rows.length; i += 5) chunks.push(rows.slice(i, i + 5));

  for (const chunk of chunks) {
    const pdfs = await Promise.all(
      chunk.map(async inv => ({ inv, pdf: await fetchPdf(inv) }))
    );
    results.push(...pdfs);
  }

  const successful = results.filter(r => r.pdf !== null);
  const skipped    = results.filter(r => r.pdf === null);

  if (successful.length === 0) {
    return NextResponse.json(
      { error: "No PDFs could be fetched. Make sure QuickBooks Online or Xero is connected." },
      { status: 422 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  // Single invoice — stream PDF directly
  if (successful.length === 1) {
    const { inv, pdf } = successful[0];
    const filename = `INV-${inv.invoiceNumber}.pdf`;
    return new NextResponse(pdf!, {
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Skipped-Count":     String(skipped.length),
      },
    });
  }

  // Multiple invoices — bundle into ZIP
  const zip = new JSZip();
  for (const { inv, pdf } of successful) {
    zip.file(`INV-${inv.invoiceNumber}.pdf`, pdf!);
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const zipName   = `invoices-${today}.zip`;

  return new NextResponse(zipBuffer, {
    headers: {
      "Content-Type":        "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
      "X-Skipped-Count":     String(skipped.length),
      "X-Included-Count":    String(successful.length),
    },
  });
}
