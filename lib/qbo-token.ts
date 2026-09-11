/**
 * Shared QBO token helper — used by PDF fetching and any other
 * server-side code that needs a valid QBO access token for an org.
 */

import { db } from "@/db";
import { qboTokens, organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

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

  // Tokens are encrypted at rest — decrypt for use (legacy plaintext passes through).
  const refreshToken = decryptSecret(token.refreshToken)!;
  const accessToken  = decryptSecret(token.accessToken)!;

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
          refresh_token: refreshToken,
        }),
      }
    );

    if (res.ok) {
      const d = await res.json();
      await db
        .update(qboTokens)
        .set({
          accessToken:          encryptSecret(d.access_token)!,
          refreshToken:         d.refresh_token ? encryptSecret(d.refresh_token)! : token.refreshToken,
          accessTokenExpiresAt: new Date(now + d.expires_in * 1000),
          updatedAt:            new Date(),
        })
        .where(eq(qboTokens.orgId, orgId));
      return { accessToken: d.access_token, realmId: token.realmId };
    }
    // Refresh failed — almost always the refresh token itself has expired or
    // been revoked at Intuit's end (100 days of inactivity, or the customer
    // disconnected/reconnected). Reusing the already-expiring access token
    // anyway just trades this clear signal for a bare "HTTP 401" surfacing
    // deep inside whatever it's used for (e.g. a Data Studio batch job) —
    // treat it the same as "not connected" so callers show a real message.
    const errBody = await res.text().catch(() => "");
    console.warn(`[qbo-token] refresh failed for org ${orgId} (HTTP ${res.status}): ${errBody.slice(0, 300)}`);
    return null;
  }

  return { accessToken, realmId: token.realmId };
}

const QBO_PDF_TIMEOUT_MS = 12_000;
const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

/**
 * Fetch an invoice PDF from QBO as a Buffer.
 * Returns null if the invoice has no qboId, QBO is not connected,
 * or the fetch fails — so the caller can still send the email without an attachment.
 *
 * By default the PDF comes back with QBO's "Review and pay online" button
 * stamped on it (see stampQboPayButton) — QBO's PDF export doesn't reliably
 * carry one, and customers compare our invoices against the ones their
 * accountant sends from QBO. Pass `{ payButton: false }` for internal copies
 * that shouldn't invite payment.
 */
export async function fetchQboInvoicePdf(
  orgId: string,
  invoice: { qboId?: string | null; invoiceNumber: string },
  opts: { payButton?: boolean } = {}
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
    if (buf.byteLength === 0) return null;
    const pdf = Buffer.from(buf);
    return opts.payButton === false ? pdf : await stampQboPayButton(orgId, invoice, pdf);
  } catch (e: any) {
    console.warn(`fetchQboInvoicePdf: failed for ${invoice.invoiceNumber}:`, e?.message);
    return null;
  }
}

/**
 * Why an invoice has no QBO payment link. Per Intuit's Invoice API reference,
 * `InvoiceLink` is "generated only for invoices with online payment enabled
 * and having a valid customer email address" — and the invoice-level
 * `AllowOnlineCreditCardPayment`/`AllowOnlineACHPayment` flags are themselves
 * only "active when the company is payments-enabled, i.e.
 * Preferences.SalesFormsPrefs.ETransactionPaymentEnabled is set to true".
 *
 * Three preconditions, three different fixes — so we report WHICH one failed
 * rather than a dead-end "no link available".
 */
export type QboPayLinkReason =
  | "ok"
  | "not_qbo"               // Xero / native / credit memo — nothing to ask QBO for
  | "qbo_not_connected"
  | "disabled_for_org"            // we were told to stop surfacing links (org opt-out)
  | "company_payments_disabled"   // org must switch on QuickBooks Payments e-invoicing
  | "invoice_online_payment_off"  // per-invoice card/ACH checkboxes are unticked
  | "no_bill_email"               // QBO needs a customer email on the invoice
  | "no_link_returned"            // preconditions look met but QBO still gave nothing
  | "lookup_failed";

export interface QboPayInfo {
  payUrl: string | null;
  reason: QboPayLinkReason;
  companyPaymentsEnabled: boolean | null;
  allowCard: boolean | null;
  allowAch: boolean | null;
  billEmail: string | null;
}

/**
 * Whether this org wants us surfacing pay links at all (organisations
 * .pay_links_enabled). Opt-OUT: absent/true means yes.
 */
const ORG_FLAG_TTL_MS = 60 * 1000;
const orgFlagCache = new Map<string, { value: boolean; expires: number }>();

async function orgPayLinksEnabled(orgId: string): Promise<boolean> {
  const hit = orgFlagCache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit.value;
  try {
    const [org] = await db.select({ enabled: organisations.payLinksEnabled })
      .from(organisations).where(eq(organisations.id, orgId)).limit(1);
    const value = org?.enabled !== false;
    // Short TTL: toggling the setting should take effect promptly, but a
    // 20-invoice portal load shouldn't re-read it 20 times.
    orgFlagCache.set(orgId, { value, expires: Date.now() + ORG_FLAG_TTL_MS });
    return value;
  } catch {
    return true; // never let a settings read break invoice delivery
  }
}

/**
 * Company-level payments flag, cached in-process.
 *
 * Multi-tenant cost control: without this we asked QBO for a link once PER
 * INVOICE even for orgs that can never have one (a chase run = one wasted call
 * per invoice, a portal page load = up to 20), all counting against that
 * company's QBO rate limit. One cached preference read now short-circuits the
 * lot. TTL is short so enabling payments in QBO shows up quickly.
 */
const PAYMENTS_PREF_TTL_MS = 10 * 60 * 1000;
const paymentsPrefCache = new Map<string, { value: boolean | null; expires: number }>();

async function companyPaymentsEnabledCached(orgId: string, token: OrgQboToken): Promise<boolean | null> {
  const hit = paymentsPrefCache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await qboCompanyPaymentsEnabled(token);
  paymentsPrefCache.set(orgId, { value, expires: Date.now() + PAYMENTS_PREF_TTL_MS });
  return value;
}

/** Is the company itself payments-enabled? (Preferences.SalesFormsPrefs) */
async function qboCompanyPaymentsEnabled(token: OrgQboToken): Promise<boolean | null> {
  try {
    const res = await fetch(
      `${QBO_API}/${token.realmId}/query?query=${encodeURIComponent("select * from Preferences")}&minorversion=65`,
      { headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const prefs = data?.QueryResponse?.Preferences?.[0];
    const v = prefs?.SalesFormsPrefs?.ETransactionPaymentEnabled;
    return typeof v === "boolean" ? v : null;
  } catch {
    return null;
  }
}

/**
 * QBO's own online-invoice payment link ("Review and pay") plus the
 * preconditions behind it — this is what QBO embeds when the org's accountant
 * sends the invoice from QBO directly, and what our emails/PDFs were missing.
 *
 * `include=invoiceLink` is required — QBO omits the field otherwise. Fetched
 * on demand (at send/download time), never persisted, so the link can't go
 * stale.
 */
export async function fetchQboInvoicePayInfo(
  orgId: string,
  invoice: { qboId?: string | null; invoiceNumber: string }
): Promise<QboPayInfo> {
  const blank: QboPayInfo = { payUrl: null, reason: "not_qbo", companyPaymentsEnabled: null, allowCard: null, allowAch: null, billEmail: null };
  if (!invoice.qboId || invoice.qboId.startsWith("CM-")) return blank;

  // Org opted out of pay links entirely — don't ask QBO, don't render anything.
  if (!(await orgPayLinksEnabled(orgId))) return { ...blank, reason: "disabled_for_org" };

  const token = await getOrgQboToken(orgId).catch(() => null);
  if (!token) return { ...blank, reason: "qbo_not_connected" };

  // Company can't take online payments → QBO will never mint a link for ANY of
  // its invoices, so stop here instead of asking once per invoice.
  if ((await companyPaymentsEnabledCached(orgId, token)) === false) {
    return { ...blank, reason: "company_payments_disabled", companyPaymentsEnabled: false };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), QBO_PDF_TIMEOUT_MS);

    const res = await fetch(
      `${QBO_API}/${token.realmId}/invoice/${invoice.qboId}?minorversion=65&include=invoiceLink`,
      { headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" }, signal: controller.signal },
    );

    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`fetchQboInvoicePayInfo: QBO returned ${res.status} for invoice ${invoice.invoiceNumber}`);
      return { ...blank, reason: "lookup_failed" };
    }

    const inv = (await res.json())?.Invoice ?? {};
    const payUrl: string | null = inv.InvoiceLink ?? null;
    const allowCard: boolean | null = typeof inv.AllowOnlineCreditCardPayment === "boolean" ? inv.AllowOnlineCreditCardPayment : null;
    const allowAch: boolean | null = typeof inv.AllowOnlineACHPayment === "boolean" ? inv.AllowOnlineACHPayment : null;
    const billEmail: string | null = inv.BillEmail?.Address ?? null;

    if (payUrl) {
      return { payUrl, reason: "ok", companyPaymentsEnabled: true, allowCard, allowAch, billEmail };
    }

    // No link — work out which precondition is the blocker so the UI can say
    // something actionable instead of shrugging.
    const companyPaymentsEnabled = await companyPaymentsEnabledCached(orgId, token);
    let reason: QboPayLinkReason = "no_link_returned";
    if (companyPaymentsEnabled === false) reason = "company_payments_disabled";
    else if (allowCard === false && allowAch === false) reason = "invoice_online_payment_off";
    else if (!billEmail) reason = "no_bill_email";

    return { payUrl: null, reason, companyPaymentsEnabled, allowCard, allowAch, billEmail };
  } catch (e: any) {
    console.warn(`fetchQboInvoicePayInfo: failed for ${invoice.invoiceNumber}:`, e?.message);
    return { ...blank, reason: "lookup_failed" };
  }
}

/** Just the link — for callers that only need the URL (email templates, etc.). */
export async function fetchQboInvoiceLink(
  orgId: string,
  invoice: { qboId?: string | null; invoiceNumber: string }
): Promise<string | null> {
  return (await fetchQboInvoicePayInfo(orgId, invoice)).payUrl;
}

/**
 * Overlay QBO's "Review and pay online" button onto an invoice PDF we're about
 * to hand to a customer. Returns the PDF unchanged when there's no link to
 * point at (Xero/native invoices, or QBO declining to generate one) or if
 * stamping fails — never fails the download/send over a missing button.
 */
export async function stampQboPayButton(
  orgId: string,
  invoice: { qboId?: string | null; invoiceNumber: string },
  pdf: Buffer,
): Promise<Buffer> {
  const payUrl = await fetchQboInvoiceLink(orgId, invoice).catch(() => null);
  if (!payUrl) return pdf;
  try {
    const { stampPayButtonOnPdf } = await import("@/lib/qbo-pay-button");
    return await stampPayButtonOnPdf(pdf, payUrl);
  } catch (e: any) {
    console.warn(`stampQboPayButton: failed for ${invoice.invoiceNumber}:`, e?.message);
    return pdf;
  }
}
