import { db } from "@/db";
import { invoices, qboTokens } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { eq, and } from "drizzle-orm";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";
const PDF_TIMEOUT_MS = 15_000; // 15 seconds — fail fast if QBO is slow

async function getOrgToken(orgId: string) {
  const [token] = await db.select().from(qboTokens).where(eq(qboTokens.orgId, orgId)).limit(1);
  if (!token) return null;
  const now = Date.now();
  if (new Date(token.accessTokenExpiresAt).getTime() - now < 5 * 60 * 1000) {
    const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refreshToken }),
    });
    if (!res.ok) return token;
    const d = await res.json();
    await db.update(qboTokens).set({
      accessToken: d.access_token,
      refreshToken: d.refresh_token || token.refreshToken,
      accessTokenExpiresAt: new Date(now + d.expires_in * 1000),
      updatedAt: new Date(),
    }).where(eq(qboTokens.orgId, orgId));
    return { ...token, accessToken: d.access_token };
  }
  return token;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!))).limit(1);
  if (!inv) return bad("Invoice not found", 404);
  if (!inv.qboId || inv.qboId.startsWith("CM-")) return bad("No QBO PDF available for this invoice", 400);

  const token = await getOrgToken(orgId!);
  if (!token) return bad("QuickBooks not connected", 400);

  // Abort if QBO takes longer than PDF_TIMEOUT_MS
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_TIMEOUT_MS);

  try {
    const pdfRes = await fetch(
      `${QBO_API}/${token.realmId}/invoice/${inv.qboId}/pdf?minorversion=65`,
      {
        headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/pdf" },
        signal: controller.signal,
      }
    );

    clearTimeout(timer);

    if (!pdfRes.ok) {
      const errText = await pdfRes.text().catch(() => "");
      console.error(`QBO PDF fetch failed for ${inv.invoiceNumber}: HTTP ${pdfRes.status} — ${errText}`);
      return bad(`PDF unavailable (QBO returned ${pdfRes.status})`, 502);
    }

    const pdfBuffer = await pdfRes.arrayBuffer();
    if (pdfBuffer.byteLength === 0) return bad("QBO returned an empty PDF", 502);

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Invoice-${inv.invoiceNumber}.pdf"`,
        "Content-Length": pdfBuffer.byteLength.toString(),
        "Cache-Control": "private, max-age=300", // cache 5 min in browser — same PDF won't re-fetch
      },
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === "AbortError") {
      console.error(`QBO PDF timeout for invoice ${inv.invoiceNumber}`);
      return bad("PDF request timed out — QBO did not respond in time. Try again.", 504);
    }
    console.error(`PDF fetch error for ${inv.invoiceNumber}:`, e);
    return bad("Failed to fetch PDF from QuickBooks", 500);
  }
}
