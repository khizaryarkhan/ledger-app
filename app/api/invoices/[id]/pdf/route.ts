import { db } from "@/db";
import { invoices, qboTokens } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { eq } from "drizzle-orm";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

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

  const [inv] = await db.select().from(invoices).where(eq(invoices.id, params.id)).limit(1);
  if (!inv) return bad("Invoice not found", 404);
  if (!inv.qboId || inv.qboId.startsWith("CM-")) return bad("No QBO PDF available for this invoice", 400);

  const token = await getOrgToken(orgId!);
  if (!token) return bad("QuickBooks not connected. An admin must connect QBO in Settings.", 400);

  const pdfRes = await fetch(
    `${QBO_API}/${token.realmId}/invoice/${inv.qboId}/pdf?minorversion=65`,
    { headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/pdf" } }
  );

  if (!pdfRes.ok) {
    console.error("QBO PDF fetch failed:", await pdfRes.text());
    return bad(`Failed to fetch PDF from QuickBooks: ${pdfRes.status}`, 500);
  }

  const pdfBuffer = await pdfRes.arrayBuffer();
  return new Response(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Invoice-${inv.invoiceNumber}.pdf"`,
      "Content-Length": pdfBuffer.byteLength.toString(),
    },
  });
}
