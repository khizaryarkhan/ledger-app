/**
 * Xero token helper — used by xero-sync.ts and any server-side code
 * that needs a valid Xero access token for an org.
 *
 * Xero access tokens expire every 30 minutes.
 * Refresh tokens expire after 60 days (rolling window on each refresh).
 */

import { db } from "@/db";
import { xeroTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";

export interface OrgXeroToken {
  accessToken: string;
  tenantId: string;
  orgId: string;
  userId: string;
}

/**
 * Return a valid (auto-refreshed) Xero access token for the given org.
 * Returns null if the org has no Xero connection.
 * Throws if the refresh token is expired (org must reconnect).
 */
export async function getOrgXeroToken(orgId: string): Promise<OrgXeroToken | null> {
  const [token] = await db
    .select()
    .from(xeroTokens)
    .where(eq(xeroTokens.orgId, orgId))
    .limit(1);

  if (!token) return null;

  // Tokens are encrypted at rest — decrypt for use (legacy plaintext passes through).
  const refreshTokenPlain = decryptSecret(token.refreshToken)!;
  const accessTokenPlain  = decryptSecret(token.accessToken)!;

  const now = Date.now();

  // Refresh if less than 5 minutes remaining on the access token
  if (new Date(token.accessTokenExpiresAt).getTime() - now < 5 * 60 * 1000) {
    const clientId = process.env.XERO_CLIENT_ID;
    const clientSecret = process.env.XERO_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error("XERO_CLIENT_ID and XERO_CLIENT_SECRET must be set");
    }

    const res = await fetch(XERO_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshTokenPlain,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Xero refresh token rejected (HTTP ${res.status}). Reconnect Xero under Settings → Integrations. Detail: ${body.slice(0, 200)}`
      );
    }

    const d = await res.json();
    await db
      .update(xeroTokens)
      .set({
        accessToken: encryptSecret(d.access_token)!,
        refreshToken: d.refresh_token ? encryptSecret(d.refresh_token)! : token.refreshToken,
        accessTokenExpiresAt: new Date(now + (d.expires_in || 1800) * 1000),
        // Xero rolling 60-day refresh token window
        refreshTokenExpiresAt: new Date(now + 60 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(xeroTokens.orgId, orgId));

    return {
      accessToken: d.access_token,
      tenantId: token.tenantId,
      orgId: token.orgId!,
      userId: token.userId,
    };
  }

  return {
    accessToken: accessTokenPlain,
    tenantId: token.tenantId,
    orgId: token.orgId!,
    userId: token.userId,
  };
}

const XERO_API = "https://api.xero.com/api.xro/2.0";
const XERO_PDF_TIMEOUT_MS = 15_000;

/**
 * Fetch a Xero invoice as a PDF. Returns null on any failure (caller treats a
 * missing PDF as "send without attachment"). Mirrors fetchQboInvoicePdf.
 */
export async function fetchXeroInvoicePdf(
  orgId: string,
  invoice: { xeroId?: string | null; invoiceNumber: string }
): Promise<Buffer | null> {
  if (!invoice.xeroId || invoice.xeroId.startsWith("CN-")) return null;

  const token = await getOrgXeroToken(orgId).catch(() => null);
  if (!token) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), XERO_PDF_TIMEOUT_MS);

    const res = await fetch(`${XERO_API}/Invoices/${invoice.xeroId}`, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Xero-Tenant-Id": token.tenantId,
        Accept: "application/pdf",
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`fetchXeroInvoicePdf: Xero returned ${res.status} for invoice ${invoice.invoiceNumber}`);
      return null;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    return buf.byteLength > 0 ? buf : null;
  } catch (e: any) {
    console.warn(`fetchXeroInvoicePdf: error for invoice ${invoice.invoiceNumber}: ${e?.message || e}`);
    return null;
  }
}
