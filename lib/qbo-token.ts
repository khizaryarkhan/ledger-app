/**
 * Shared QBO token helper — used by PDF fetching and any other
 * server-side code that needs a valid QBO access token for an org.
 */

import { db } from "@/db";
import { qboTokens } from "@/db/schema";
import { eq } from "drizzle-orm";

export interface OrgQboToken {
  accessToken: string;
  realmId: string;
}

/**
 * Return a valid (auto-refreshed) QBO access token for the given org.
 * Returns null if the org has no QBO connection.
 */
export async function getOrgQboToken(orgId: string): Promise<OrgQboToken | null> {
  const [token] = await db
    .select()
    .from(qboTokens)
    .where(eq(qboTokens.orgId, orgId))
    .limit(1);

  if (!token) return null;

  const now = Date.now();

  // Refresh if less than 5 minutes remaining
  if (new Date(token.accessTokenExpiresAt).getTime() - now < 5 * 60 * 1000) {
    const res = await fetch(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(
            `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
          ).toString("base64")}`,
        },
        body: new URLSearchParams({
          grant_type:    "refresh_token",
          refresh_token: token.refreshToken,
        }),
      }
    );

    if (res.ok) {
      const d = await res.json();
      await db
        .update(qboTokens)
        .set({
          accessToken:          d.access_token,
          refreshToken:         d.refresh_token || token.refreshToken,
          accessTokenExpiresAt: new Date(now + d.expires_in * 1000),
          updatedAt:            new Date(),
        })
        .where(eq(qboTokens.orgId, orgId));
      return { accessToken: d.access_token, realmId: token.realmId };
    }
    // Refresh failed — use the existing token and hope for the best
  }

  return { accessToken: token.accessToken, realmId: token.realmId };
}

const QBO_PDF_TIMEOUT_MS = 12_000;
const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

/**
 * Fetch an invoice PDF from QBO as a Buffer.
 * Returns null if the invoice has no qboId, QBO is not connected,
 * or the fetch fails — so the caller can still send the email without an attachment.
 */
export async function fetchQboInvoicePdf(
  orgId: string,
  invoice: { qboId?: string | null; invoiceNumber: string }
): Promise<Buffer | null> {
  if (!invoice.qboId || invoice.qboId.startsWith("CM-")) return null;

  const token = await getOrgQboToken(orgId).catch(() => null);
  if (!token) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), QBO_PDF_TIMEOUT_MS);

    const res = await fetch(
      `${QBO_API}/${token.realmId}/invoice/${invoice.qboId}/pdf?minorversion=65`,
      {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept:        "application/pdf",
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timer);

    if (!res.ok) {
      console.warn(
        `fetchQboInvoicePdf: QBO returned ${res.status} for invoice ${invoice.invoiceNumber}`
      );
      return null;
    }

    const buf = await res.arrayBuffer();
    return buf.byteLength > 0 ? Buffer.from(buf) : null;
  } catch (e: any) {
    console.warn(`fetchQboInvoicePdf: failed for ${invoice.invoiceNumber}:`, e?.message);
    return null;
  }
}
