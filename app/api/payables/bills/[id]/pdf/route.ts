import { db } from "@/db";
import { apBills } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { eq, and } from "drizzle-orm";
import { getOrgXeroToken } from "@/lib/xero-token";
import { renderLedgerDocumentPdf, renderBillSnapshotPdf } from "@/lib/pdf/document-pdf";

// Headless Chromium (lib/pdf/render-html.ts) cannot run on the Edge runtime.
export const runtime = "nodejs";

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

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [bill] = await db.select().from(apBills)
    .where(and(eq(apBills.id, params.id), eq(apBills.orgId, orgId!)))
    .limit(1);
  if (!bill) return bad("Bill not found", 404);

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

  // QBO does not support bill PDF via API, and a native bill is never fetched
  // from a provider at all — render our own through the one shared engine.
  // A native/posted bill has entryId set (lib/accounting/documents.ts); a
  // QBO/Xero/Sage-mirrored bill never does (see apBills.entryId's own schema
  // comment), so it renders from the ap_bills/ap_bill_lines snapshot instead.
  try {
    const pdfBuffer = bill.entryId
      ? await renderLedgerDocumentPdf(orgId!, bill.entryId)
      : await renderBillSnapshotPdf(orgId!, bill.id);
    if (!pdfBuffer) return bad("Failed to generate PDF", 500);
    return new Response(pdfBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Bill-${bill.billNumber ?? bill.id}.pdf"`,
        "Content-Length": pdfBuffer.byteLength.toString(),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e: any) {
    console.error("Bill PDF generation error:", e);
    return bad("Failed to generate PDF", 500);
  }
}
