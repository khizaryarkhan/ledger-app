/**
 * QBO Data Verification — read-only audit
 *
 * GET /api/qbo/verify
 *
 * Fetches counts of each entity type from BOTH QBO and our ledger,
 * showing how many of each exist in each system. Used to answer:
 * "Is the sync actually pulling everything?"
 *
 * No writes. Safe to run any time.
 */

import { db } from "@/db";
import {
  qboTokens, customers, invoices, payments, paymentApplications, refundReceipts, projects,
} from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, sql, and, isNull, isNotNull } from "drizzle-orm";
import { decryptSecret } from "@/lib/crypto";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

export const maxDuration = 60; // ?details=1 pages every id out of QuickBooks

async function qboCount(
  accessToken: string,
  realmId: string,
  entity: string,
  filter?: string,
): Promise<number> {
  const where = filter ? ` WHERE ${filter}` : "";
  const query = `SELECT COUNT(*) FROM ${entity}${where}`;
  const url = `${QBO_API}/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) return -1;
  const data = await res.json();
  return data?.QueryResponse?.totalCount ?? 0;
}

async function refreshToken(token: any): Promise<string> {
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: decryptSecret(token.refreshToken)! }),
  });
  if (!res.ok) return decryptSecret(token.accessToken)!;
  const d = await res.json();
  return d.access_token as string;
}

/** Every Id of a QBO entity, paged 1,000 at a time. Null if any page fails — a partial list must not be compared. */
async function qboIds(accessToken: string, realmId: string, entity: string): Promise<Set<string> | null> {
  const ids = new Set<string>();
  for (let start = 1; start < 200_000; start += 1000) {
    const query = `SELECT Id FROM ${entity} STARTPOSITION ${start} MAXRESULTS 1000`;
    const res = await fetch(`${QBO_API}/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const list: any[] = (await res.json())?.QueryResponse?.[entity] ?? [];
    for (const r of list) ids.add(String(r.Id));
    if (list.length < 1000) return ids;
  }
  return ids;
}

const MAX_LISTED = 50;

/**
 * The records behind a count mismatch, named: in the app but no longer in
 * QuickBooks, and in QuickBooks but not in the app. Counts alone said EDC had
 * 7 invoices too many and 3 payments too few, and nothing could say which.
 */
async function mismatches(accessToken: string, realmId: string, orgId: string) {
  const [qInv, qCm, qPay, appInv, appPay] = await Promise.all([
    qboIds(accessToken, realmId, "Invoice"),
    qboIds(accessToken, realmId, "CreditMemo"),
    qboIds(accessToken, realmId, "Payment"),
    db.select({ qboId: invoices.qboId, number: invoices.invoiceNumber, txnType: invoices.txnType })
      .from(invoices).where(and(eq(invoices.orgId, orgId), isNull(invoices.deletedAt), isNotNull(invoices.qboId))),
    db.select({ qboId: payments.qboId }).from(payments).where(eq(payments.orgId, orgId)),
  ]);
  const diff = (app: { id: string; label: string }[], qbo: Set<string> | null) => {
    if (!qbo) return { error: "QuickBooks list could not be read in full; not compared" };
    const appIds = new Set(app.map((a) => a.id));
    const inAppOnly = app.filter((a) => !qbo.has(a.id)).map((a) => a.label);
    const inQboOnly = [...qbo].filter((id) => !appIds.has(id));
    return {
      inAppOnly: inAppOnly.slice(0, MAX_LISTED), inAppOnlyCount: inAppOnly.length,
      inQboOnly: inQboOnly.slice(0, MAX_LISTED), inQboOnlyCount: inQboOnly.length,
    };
  };
  // Credit memos are stored with a "CM-" prefix on their QuickBooks id (lib/qbo-sync.ts).
  const inv = appInv.filter((r) => r.txnType === "Invoice").map((r) => ({ id: String(r.qboId), label: `${r.number} (QBO ${r.qboId})` }));
  const cm = appInv.filter((r) => r.txnType === "CreditMemo")
    .map((r) => ({ id: String(r.qboId).replace(/^CM-/, ""), label: `${r.number} (QBO ${r.qboId})` }));
  const pay = appPay.filter((p) => p.qboId).map((p) => ({ id: String(p.qboId), label: `payment QBO ${p.qboId}` }));
  return { invoices: diff(inv, qInv), creditMemos: diff(cm, qCm), payments: diff(pay, qPay) };
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [token] = await db.select().from(qboTokens).where(eq(qboTokens.orgId, orgId!));
  if (!token) return bad("No QBO connection for this org", 400);

  const accessToken = new Date(token.accessTokenExpiresAt).getTime() - Date.now() < 60_000
    ? await refreshToken(token)
    : decryptSecret(token.accessToken)!;

  // QBO counts (read-only API calls)
  // Customer table in QBO contains BOTH top-level customers and sub-customers (jobs).
  // Our app splits them: top-level → customers table, sub-customers → projects table.
  // So we count them separately.
  const [
    qboTopCustomers, qboSubCustomers, qboInvoices, qboCreditMemos, qboPayments, qboRefunds,
  ] = await Promise.all([
    qboCount(accessToken, token.realmId, "Customer", "Job = false"),
    qboCount(accessToken, token.realmId, "Customer", "Job = true"),
    qboCount(accessToken, token.realmId, "Invoice"),
    qboCount(accessToken, token.realmId, "CreditMemo"),
    qboCount(accessToken, token.realmId, "Payment"),
    qboCount(accessToken, token.realmId, "RefundReceipt"),
  ]);

  // Ledger counts (org-scoped)
  const liveMirrored = and(eq(invoices.orgId, orgId!), isNull(invoices.deletedAt), isNotNull(invoices.qboId));
  const [
    ledgerCustomers, ledgerProjects, ledgerInvoices, ledgerCreditMemos, ledgerPayments,
    ledgerApplications, ledgerRefunds,
  ] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(customers).where(eq(customers.orgId, orgId!)),
    db.select({ n: sql<number>`count(*)::int` }).from(projects).where(eq(projects.orgId, orgId!)),
    // Only rows that mirror QuickBooks and still exist there: a native invoice was
    // never in QBO, and a deleted one is gone from it. Counting both made the app
    // look like it held MORE than QuickBooks (EDC: 6,719 vs 6,706).
    db.select({ n: sql<number>`count(*)::int` }).from(invoices).where(and(liveMirrored, eq(invoices.txnType, "Invoice"))),
    db.select({ n: sql<number>`count(*)::int` }).from(invoices).where(and(liveMirrored, eq(invoices.txnType, "CreditMemo"))),
    db.select({ n: sql<number>`count(*)::int` }).from(payments).where(eq(payments.orgId, orgId!)),
    db.select({ n: sql<number>`count(*)::int` }).from(paymentApplications).where(eq(paymentApplications.orgId, orgId!)),
    db.select({ n: sql<number>`count(*)::int` }).from(refundReceipts).where(eq(refundReceipts.orgId, orgId!)),
  ]);

  const rows = [
    { entity: "Customers (top-level)", qbo: qboTopCustomers, ledger: ledgerCustomers[0]?.n ?? 0 },
    { entity: "Projects (sub-customers)", qbo: qboSubCustomers, ledger: ledgerProjects[0]?.n ?? 0 },
    { entity: "Invoices",       qbo: qboInvoices,     ledger: ledgerInvoices[0]?.n ?? 0 },
    { entity: "Credit Memos",   qbo: qboCreditMemos,  ledger: ledgerCreditMemos[0]?.n ?? 0 },
    { entity: "Payments",       qbo: qboPayments,     ledger: ledgerPayments[0]?.n ?? 0 },
    { entity: "Refund Receipts",qbo: qboRefunds,      ledger: ledgerRefunds[0]?.n ?? 0 },
  ];

  // ?details=1 names the records behind each mismatch. Opt-in: it pages every
  // Invoice/CreditMemo/Payment id out of QuickBooks (~20 calls for EDC).
  const details = new URL(req.url).searchParams.get("details") === "1"
    ? await mismatches(accessToken, token.realmId, orgId!)
    : undefined;

  return ok({
    rows,
    ...(details ? { details } : {}),
    paymentApplications: ledgerApplications[0]?.n ?? 0,
    checkedAt: new Date().toISOString(),
  });
}
