/**
 * Raw QBO AgedReceivableDetail dump.
 *
 * GET /api/qbo/debug-aging?asOf=YYYY-MM-DD[&customer=<qboCustomerId>][&agingMethod=Report_Date|Current]
 *
 * Returns the unaltered response QBO's API gave us, plus a flattened
 * summary of every leaf row so you can see exactly which transactions QBO
 * is reporting as open on the report date.
 *
 * If our AR Aging report shows a number that doesn't match QBO's UI,
 * compare it to this output:
 *   - If this output contains the row you expect to NOT see → QBO is
 *     returning it. The issue is in QBO data (e.g. an unapplied JE), not
 *     in our app. Fix it in QBO and resync.
 *   - If this output does NOT contain that row → there's an API vs UI
 *     mismatch and I'll dig into the parser.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getValidToken } from "@/lib/qbo-sync";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const asOf = url.searchParams.get("asOf") || new Date().toISOString().slice(0, 10);
  const customerFilter = url.searchParams.get("customer"); // QBO customer id
  const agingMethod = url.searchParams.get("agingMethod") === "Current" ? "Current" : "Report_Date";

  const token = await getValidToken(orgId!);
  if (!token) return bad("QBO not connected", 400);

  const qs = new URLSearchParams({
    report_date: asOf,
    aging_method: agingMethod,
    accounting_method: "Accrual",
    num_periods: "4",
    aging_period: "30",
    minorversion: "65",
  });
  if (customerFilter) qs.set("customer", customerFilter);

  if (process.env.QBO_REPORTS_MODERN === "true") qs.set("testing_migration", "true");
  const qboUrl = `${QBO_API}/${token.realmId}/reports/AgedReceivableDetail?${qs.toString()}`;
  const res = await fetch(qboUrl, {
    headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    return bad(`QBO ${res.status}: ${await res.text()}`, res.status);
  }
  const report = await res.json();

  // Flatten every leaf row to a clean list so the user can scan.
  function* walk(node: any): Generator<any> {
    if (!node) return;
    if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
    if (node.Rows?.Row) { yield* walk(node.Rows.Row); return; }
    if (Array.isArray(node.ColData) && node.type !== "Section") yield node;
  }
  const columns: any[] = report?.Columns?.Column || [];
  const colTitles = columns.map(c => c?.ColTitle || "");

  const rows: any[] = [];
  for (const row of walk(report?.Rows?.Row)) {
    const cd = row.ColData;
    if (!Array.isArray(cd)) continue;
    const obj: Record<string, any> = {};
    for (let i = 0; i < cd.length; i++) {
      obj[colTitles[i] || `col${i}`] = cd[i]?.value ?? null;
      if (cd[i]?.id) obj[`${colTitles[i] || `col${i}`}_id`] = cd[i].id;
    }
    rows.push(obj);
  }

  // Extract the report-level total row (if present in payload).
  let qboReportTotal: any = null;
  for (const r of report?.Rows?.Row || []) {
    if (r?.Summary?.ColData) {
      const cols = r.Summary.ColData;
      qboReportTotal = {};
      for (let i = 0; i < cols.length; i++) qboReportTotal[colTitles[i] || `col${i}`] = cols[i]?.value;
    }
  }

  return ok({
    asOf,
    agingMethod,
    customerFilter,
    qboCallUrl: qboUrl.replace(/access_token=[^&]+/, "access_token=REDACTED"),
    qboReportTotal,
    columns: colTitles,
    rowCount: rows.length,
    rows,
    rawResponse: report, // full unchanged payload for forensic comparison
  });
}
