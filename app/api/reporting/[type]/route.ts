/**
 * GET /api/reporting/[type]?from=YYYY-MM-DD&to=YYYY-MM-DD&asOf=YYYY-MM-DD
 *
 * Unified reporting API. Detects which integration is connected (QBO or Xero)
 * and fetches the native report from that provider. Returns the raw report
 * body plus metadata so the UI can render it with provider-specific logic.
 *
 * Supported types:
 *   profit-loss      → QBO: ProfitAndLoss         / Xero: ProfitAndLoss
 *   balance-sheet    → QBO: BalanceSheet           / Xero: BalanceSheet
 *   cash-flow        → QBO: CashFlow               / Xero: CashSummary
 *   ar-aging         → QBO: AgedReceivableDetail   / Xero: AgedReceivablesByContact
 *   ap-aging         → QBO: AgedPayableDetail      / Xero: AgedPayablesByContact
 *   trial-balance    → QBO: TrialBalance           / Xero: TrialBalance
 *   executive-summary→ Xero only: ExecutiveSummary
 *   bank-summary     → Xero only: BankSummary
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getValidToken } from "@/lib/qbo-sync";
import { getOrgXeroToken } from "@/lib/xero-token";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";

const QBO_API  = "https://quickbooks.api.intuit.com/v3/company";
const XERO_API = "https://api.xero.com/api.xro/2.0";

const QBO_REPORT_MAP: Record<string, string> = {
  "profit-loss":       "ProfitAndLoss",
  "balance-sheet":     "BalanceSheet",
  "cash-flow":         "CashFlow",
  "ar-aging":          "AgedReceivableDetail",
  "ap-aging":          "AgedPayableDetail",
  "trial-balance":     "TrialBalance",
};

const XERO_REPORT_MAP: Record<string, string> = {
  "profit-loss":        "ProfitAndLoss",
  "balance-sheet":      "BalanceSheet",
  "cash-flow":          "CashSummary",
  "ar-aging":           "AgedReceivablesByContact",
  "ap-aging":           "AgedPayablesByContact",
  "trial-balance":      "TrialBalance",
  "executive-summary":  "ExecutiveSummary",
  "bank-summary":       "BankSummary",
};

function buildQboParams(type: string, from: string, to: string, asOf: string): string {
  const base = "&minorversion=65&accounting_method=Accrual";
  switch (type) {
    case "balance-sheet":
      return `?as_of=${asOf}${base}`;
    case "ar-aging":
    case "ap-aging":
      return `?report_date=${asOf}&aging_method=Report_Date${base}&num_periods=4&aging_period=30`;
    case "trial-balance":
      return `?report_date=${asOf}${base}`;
    default:
      return `?start_date=${from}&end_date=${to}${base}`;
  }
}

function buildXeroParams(type: string, from: string, to: string, asOf: string): string {
  switch (type) {
    case "balance-sheet":
      return `?date=${asOf}&periods=1&timeframe=MONTH`;
    case "ar-aging":
    case "ap-aging":
      return `?date=${asOf}`;
    case "trial-balance":
      return `?date=${asOf}`;
    case "executive-summary":
      return `?date=${asOf}`;
    default:
      return `?fromDate=${from}&toDate=${to}&periods=1&timeframe=MONTH`;
  }
}

export async function GET(req: Request, { params }: { params: { type: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  // Check reporting module is enabled for this org
  const [org] = await db
    .select({ reportingEnabled: organisations.reportingEnabled })
    .from(organisations)
    .where(eq(organisations.id, orgId!))
    .limit(1);

  if (!org?.reportingEnabled) {
    return bad("Reporting module not enabled. Enable it in Settings → Reporting.", 403);
  }

  const type = params.type;
  const url  = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const asOf  = url.searchParams.get("asOf")  ?? today;
  const from  = url.searchParams.get("from")  ?? asOf.slice(0, 7) + "-01";
  const to    = url.searchParams.get("to")    ?? asOf;

  // Try QBO first, then Xero
  const qboToken  = await getValidToken(orgId!).catch(() => null);
  const xeroToken = await getOrgXeroToken(orgId!).catch(() => null);

  if (!qboToken && !xeroToken) {
    return bad("No accounting integration connected. Connect QuickBooks or Xero under Settings → Integrations.", 400);
  }

  // Prefer QBO if connected; fall back to Xero
  if (qboToken) {
    const qboName = QBO_REPORT_MAP[type];
    if (!qboName) return bad(`Report type '${type}' is not available for QuickBooks.`, 400);

    const qboPath  = buildQboParams(type, from, to, asOf);
    const reportUrl = `${QBO_API}/${qboToken.realmId}/reports/${qboName}${qboPath}&testing_migration=true`;

    const res = await fetch(reportUrl, {
      headers: { Authorization: `Bearer ${qboToken.accessToken}`, Accept: "application/json" },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return bad(`QuickBooks returned ${res.status}: ${body.slice(0, 300)}`, 502);
    }

    const report = await res.json();

    return ok({
      provider: "qbo",
      type,
      reportName: report?.Header?.ReportName ?? qboName,
      currency: report?.Header?.Currency ?? "USD",
      generatedAt: report?.Header?.Time ?? null,
      period: { from, to, asOf },
      report,
    });
  }

  // Xero path
  const xeroName = XERO_REPORT_MAP[type];
  if (!xeroName) return bad(`Report type '${type}' is not available for Xero.`, 400);

  const xeroPath  = buildXeroParams(type, from, to, asOf);
  const reportUrl = `${XERO_API}/Reports/${xeroName}${xeroPath}`;

  const res = await fetch(reportUrl, {
    headers: {
      Authorization:    `Bearer ${xeroToken!.accessToken}`,
      "Xero-Tenant-Id": xeroToken!.tenantId,
      Accept:           "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return bad(`Xero returned ${res.status}: ${body.slice(0, 300)}`, 502);
  }

  const json   = await res.json();
  const report = json?.Reports?.[0] ?? json;

  return ok({
    provider: "xero",
    type,
    reportName: report?.ReportName ?? xeroName,
    currency: null,
    generatedAt: report?.ReportDate ?? null,
    period: { from, to, asOf },
    report,
  });
}
