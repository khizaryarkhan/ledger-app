import { db } from "@/db";
import { apBills } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { eq, and } from "drizzle-orm";
import { getOrgQboToken } from "@/lib/qbo-token";
import { getOrgXeroToken } from "@/lib/xero-token";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";
const XERO_API = "https://api.xero.com/api.xro/2.0";
const PDF_TIMEOUT_MS = 15_000;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [bill] = await db.select().from(apBills)
    .where(and(eq(apBills.id, params.id), eq(apBills.orgId, orgId!)))
    .limit(1);
  if (!bill) return bad("Bill not found", 404);

  const isXero = !!bill.xeroId;
  const isQbo = !!bill.qboId;
  if (!isXero && !isQbo) return bad("No PDF available for this bill", 400);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_TIMEOUT_MS);
  const provider = isXero ? "Xero" : "QuickBooks";

  try {
    let pdfRes: Response;

    if (isXero) {
      // Xero bills are ACCPAY invoices — same PDF endpoint, just with Accept: application/pdf
      const xt = await getOrgXeroToken(orgId!);
      if (!xt) { clearTimeout(timer); return bad("Xero not connected", 400); }
      pdfRes = await fetch(`${XERO_API}/Invoices/${bill.xeroId}`, {
        headers: {
          Authorization: `Bearer ${xt.accessToken}`,
          "Xero-Tenant-Id": xt.tenantId,
          Accept: "application/pdf",
        },
        signal: controller.signal,
      });
    } else {
      const token = await getOrgQboToken(orgId!);
      if (!token) { clearTimeout(timer); return bad("QuickBooks not connected", 400); }
      pdfRes = await fetch(
        `${QBO_API}/${token.realmId}/bill/${bill.qboId}/pdf?minorversion=65`,
        {
          headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/pdf" },
          signal: controller.signal,
        },
      );
    }

    clearTimeout(timer);

    if (!pdfRes.ok) {
      const errText = await pdfRes.text().catch(() => "");
      console.error(`${provider} bill PDF fetch failed for ${bill.billNumber}: HTTP ${pdfRes.status} — ${errText}`);
      return bad(`PDF unavailable (${provider} returned ${pdfRes.status})`, 502);
    }

    const pdfBuffer = await pdfRes.arrayBuffer();
    if (pdfBuffer.byteLength === 0) return bad(`${provider} returned an empty PDF`, 502);

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Bill-${bill.billNumber ?? bill.id}.pdf"`,
        "Content-Length": pdfBuffer.byteLength.toString(),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === "AbortError") {
      console.error(`${provider} PDF timeout for bill ${bill.billNumber}`);
      return bad(`PDF request timed out — ${provider} did not respond in time. Try again.`, 504);
    }
    console.error(`Bill PDF fetch error for ${bill.billNumber}:`, e);
    return bad(`Failed to fetch PDF from ${provider}`, 500);
  }
}
