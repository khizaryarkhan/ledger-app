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
import { eq, sql, and } from "drizzle-orm";
import { decryptSecret } from "@/lib/crypto";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

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

export async function GET() {
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
  const [
    ledgerCustomers, ledgerProjects, ledgerInvoices, ledgerCreditMemos, ledgerPayments,
    ledgerApplications, ledgerRefunds,
  ] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(customers).where(eq(customers.orgId, orgId!)),
    db.select({ n: sql<number>`count(*)::int` }).from(projects).where(eq(projects.orgId, orgId!)),
    db.select({ n: sql<number>`count(*)::int` }).from(invoices).where(and(eq(invoices.orgId, orgId!), eq(invoices.txnType, "Invoice"))),
    db.select({ n: sql<number>`count(*)::int` }).from(invoices).where(and(eq(invoices.orgId, orgId!), eq(invoices.txnType, "CreditMemo"))),
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

  return ok({
    rows,
    paymentApplications: ledgerApplications[0]?.n ?? 0,
    checkedAt: new Date().toISOString(),
  });
}
