/**
 * QBO-native AR Aging.
 *
 * Calls QuickBooks Online's AgedReceivableDetail report directly, which is the
 * exact engine QBO's UI uses for its own aging reports. QBO walks its GL
 * backwards from the report_date and reconstructs the AR state at that point,
 * naturally handling all the edge cases that broke our event-sourced engine:
 *   - Invoices closed by Credit Memo via LinkedTxn (no intermediate Payment)
 *   - Journal-entry write-offs / adjustments
 *   - Refund receipts
 *   - Voided / deleted transactions
 *   - Multi-currency exchange-rate-at-date
 *
 * For historical dates this is the authoritative source. For "today" we still
 * prefer the local engine because it has access to extra collection context
 * (collection_stage, owner, flags) that isn't in QBO.
 *
 * QBO docs:
 *   https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/agedreceivabledetail
 */

import { db } from "@/db";
import { qboTokens, customers, invoices, projects } from "@/db/schema";
import { getValidToken } from "@/lib/qbo-sync";
import { and, eq } from "drizzle-orm";
import type { AgingBucket, AgingResult, DetailRow, SummaryRow } from "@/lib/ar-aging";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";
const BUCKETS: AgingBucket[] = ["Current", "1-30", "31-60", "61-90", "91+"];

function emptyBuckets(): Record<AgingBucket, number> {
  return { "Current": 0, "1-30": 0, "31-60": 0, "61-90": 0, "91+": 0 };
}

/**
 * Normalise QBO's bucket labels to our canonical names.
 * QBO returns: "Current", "1 - 30", "31 - 60", "61 - 90", "91 and over"
 * (or sometimes "> 90 days", "Over 90"). The bucket group identifier in the
 * Section row is sometimes also numeric — we handle all of it.
 */
function normaliseBucket(label: string | undefined, daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0)  return "Current";
  if (daysPastDue <= 30) return "1-30";
  if (daysPastDue <= 60) return "31-60";
  if (daysPastDue <= 90) return "61-90";
  return "91+";
}

function parseMoney(v: any): number {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[,$£€\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

function daysBetween(later: string, earlier: string): number {
  const a = new Date(later  + "T00:00:00Z").getTime();
  const b = new Date(earlier + "T00:00:00Z").getTime();
  return Math.floor((a - b) / 86400000);
}

/**
 * Iterate every leaf data row in a QBO report's hierarchical Rows tree.
 *
 * QBO reports nest Section rows (which contain Header / Rows.Row / Summary)
 * around the actual data rows. The data rows themselves often have NO
 * `type` field — only Section rows are tagged with `type: "Section"`.
 * So we identify leaves as nodes that carry ColData and do NOT have a
 * `Rows.Row` child (which would mean they're a section, not a leaf).
 */
function* walkRows(node: any): Generator<any> {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const r of node) yield* walkRows(r);
    return;
  }
  // Recurse into Section / grouping rows.
  if (node.Rows?.Row) {
    yield* walkRows(node.Rows.Row);
    return;
  }
  // Leaf data row.
  if (Array.isArray(node.ColData) && node.type !== "Section") {
    yield node;
  }
}

/**
 * QBO's AgedReceivableDetail returns columns in this order (consistent across
 * minor versions): Date, Transaction Type, Num, Customer, Due Date, Aging,
 * Open Balance. ColData entries carry an `id` on the Customer column so we
 * can map back to our internal customerId.
 *
 * We find each column by its ColTitle in the Columns header rather than by
 * fixed index so the parser stays robust if QBO adds/removes columns.
 */
function extractColumnIndex(columns: any[], titles: string[]): number {
  for (let i = 0; i < columns.length; i++) {
    const t = (columns[i]?.ColTitle || "").toLowerCase();
    if (titles.some(needle => t === needle || t.includes(needle))) return i;
  }
  return -1;
}

export async function fetchQboAging(orgId: string, asOf: string): Promise<AgingResult & { _debug?: any }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error("asOf must be YYYY-MM-DD");
  }

  const token = await getValidToken(orgId);
  if (!token) throw new Error("QuickBooks not connected");

  // Call QBO's AgedReceivableDetail with Report_Date aging method.
  // num_periods=4 + Current gives us the 5 buckets we display.
  const url =
    `${QBO_API}/${token.realmId}/reports/AgedReceivableDetail` +
    `?report_date=${asOf}` +
    `&aging_method=Report_Date` +
    `&accounting_method=Accrual` +
    `&num_periods=4` +
    `&aging_period=30` +
    `&minorversion=65`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QBO AgedReceivableDetail ${res.status}: ${text}`);
  }
  const report = await res.json();
  console.log(`[QBO aging] asOf=${asOf} columns=${report?.Columns?.Column?.length ?? 0} topRows=${report?.Rows?.Row?.length ?? 0}`);

  const columns: any[] = report?.Columns?.Column || [];
  const colDate    = extractColumnIndex(columns, ["date"]);
  const colTxnType = extractColumnIndex(columns, ["transaction type", "txn type", "type"]);
  const colNum     = extractColumnIndex(columns, ["num", "number"]);
  const colCust    = extractColumnIndex(columns, ["customer", "name"]);
  const colDue     = extractColumnIndex(columns, ["due date"]);
  const colAging   = extractColumnIndex(columns, ["aging", "past due"]);
  const colAmount  = extractColumnIndex(columns, ["open balance", "amount", "balance"]);

  // Map QBO customer Id → our internal customerId UUID.
  // QBO's aging report attributes transactions to whichever entity (parent
  // customer OR sub-customer) actually owns the invoice. In QBO sub-customers
  // are first-class — they have their own Id. In our model sub-customers
  // map to the `projects` table (parent customer + project record).
  // So we maintain three lookup maps:
  //   1. QBO Id → our customer (direct match on customers.qboId)
  //   2. QBO Id → our project's parent customer (match on projects.qboId)
  //   3. QBO name → our customer (case-insensitive fallback)
  const ourCustomers = await db.select({
    id: customers.id,
    name: customers.name,
    qboId: customers.qboId,
  }).from(customers).where(eq(customers.orgId, orgId));
  const ourCustByQboId = new Map<string, { id: string; name: string }>();
  const ourCustByName  = new Map<string, { id: string; name: string }>();
  for (const c of ourCustomers) {
    if (c.qboId) ourCustByQboId.set(c.qboId, { id: c.id, name: c.name });
    ourCustByName.set(c.name.toLowerCase(), { id: c.id, name: c.name });
  }

  // Sub-customer (project) lookup: QBO Id of the project → its parent customer.
  // Requires the qbo_id column on projects (added in migration-projects-qbo.sql)
  // to be populated. The QBO sync writes it on every sub-customer it imports.
  const ourProjects = await db.select({
    id: projects.id,
    qboId: projects.qboId,
    customerId: projects.customerId,
  }).from(projects).where(eq(projects.orgId, orgId));
  const projectByQboId = new Map<string, { projectId: string; customerId: string }>();
  for (const p of ourProjects) {
    if (p.qboId) projectByQboId.set(p.qboId, { projectId: p.id, customerId: p.customerId });
  }
  const customerNameById = new Map<string, string>();
  for (const c of ourCustomers) customerNameById.set(c.id, c.name);

  // Map QBO invoice Id → our internal invoice UUID (so the report can deep-link
  // back to the invoice page in our UI).
  const ourInvoices = await db.select({
    id: invoices.id,
    qboId: invoices.qboId,
    currency: invoices.currency,
  }).from(invoices).where(eq(invoices.orgId, orgId));
  const ourInvByQboId = new Map<string, { id: string; currency: string }>();
  for (const inv of ourInvoices) {
    if (inv.qboId) ourInvByQboId.set(inv.qboId, { id: inv.id, currency: inv.currency });
    // QBO returns CreditMemo Ids without the "CM-" prefix our ledger adds, so
    // also map by the suffix.
    if (inv.qboId?.startsWith("CM-")) {
      ourInvByQboId.set(inv.qboId.slice(3), { id: inv.id, currency: inv.currency });
    }
  }

  const detail: DetailRow[] = [];
  let missingDueDate = 0;
  let invoiceCount = 0, creditMemoCount = 0;
  let leafRowCount = 0;

  for (const row of walkRows(report?.Rows?.Row)) {
    leafRowCount++;
    const cd = row.ColData;
    if (!Array.isArray(cd) || cd.length === 0) continue;

    const txnDate     = colDate    >= 0 ? cd[colDate]?.value    : "";
    const txnTypeRaw  = colTxnType >= 0 ? cd[colTxnType]?.value : "";
    const txnNumber   = colNum     >= 0 ? cd[colNum]?.value     : "";
    const custName    = colCust    >= 0 ? cd[colCust]?.value    : "";
    const custQboId   = colCust    >= 0 ? cd[colCust]?.id       : undefined;
    const dueDate     = colDue     >= 0 ? cd[colDue]?.value     : "";
    const agingDays   = colAging   >= 0 ? parseInt(cd[colAging]?.value || "0", 10) : 0;
    const openBalance = colAmount  >= 0 ? parseMoney(cd[colAmount]?.value) : 0;
    const txnQboId    = colNum     >= 0 ? cd[colNum]?.id        : undefined;

    if (!custName && !custQboId) continue;             // Section subtotal rows
    if (Math.abs(openBalance) < 0.005) continue;       // Skip zero rows

    // 1. Direct match on customers.qboId
    let ourCust =
      (custQboId ? ourCustByQboId.get(String(custQboId)) : null) ||
      (custName  ? ourCustByName.get(String(custName).toLowerCase()) : null) ||
      null;
    // 2. Sub-customer match: QBO Id matches a project; attribute to its parent customer
    let projectId: string | null = null;
    if (!ourCust && custQboId) {
      const proj = projectByQboId.get(String(custQboId));
      if (proj) {
        projectId = proj.projectId;
        const parentName = customerNameById.get(proj.customerId);
        if (parentName) ourCust = { id: proj.customerId, name: parentName };
      }
    }

    const ourInv = txnQboId ? ourInvByQboId.get(String(txnQboId)) : null;

    const isCm = /credit\s*memo/i.test(String(txnTypeRaw));
    const isJe = /journal/i.test(String(txnTypeRaw));
    const txnType: DetailRow["txnType"] =
      isCm ? "Credit Memo" : isJe ? "Journal Entry" : "Invoice";

    // Include JEs in the aging total. QBO's own UI report shows them, and
    // matching QBO's grand total is the user's reconciliation reference.
    // (Prior version filtered JEs to match a PBI formula that defined but
    // never used journal balance variables — that diverged the total from
    // QBO by the net JE impact, typically ~20% for orgs with write-offs.)
    if (isCm) creditMemoCount++; else if (txnType === "Invoice") invoiceCount++;

    const effectiveDueDate = dueDate || txnDate;
    const flags: string[] = [];
    if (!dueDate) { flags.push("missing-due-date"); missingDueDate++; }

    // Prefer QBO's stated "Aging" days; fall back to computing from dueDate.
    const dpd = agingDays || (effectiveDueDate ? daysBetween(asOf, effectiveDueDate) : 0);
    const bucket = normaliseBucket(undefined, dpd);

    const resolvedCustomerId =
      ourCust?.id ?? (custQboId ? `qbo:${custQboId}` : `name:${custName}`);
    // Stash the QBO name on the row so the UI can render it when our
    // customers table has no matching record. We piggyback on `flags`
    // with a special prefix so we don't have to change the shared
    // DetailRow type.
    if (!ourCust && custName) flags.push(`qbo-name:${custName}`);

    detail.push({
      customerId:   resolvedCustomerId,
      customerQboId: custQboId ?? null,
      projectId,
      txnType,
      txnNumber:    String(txnNumber || ""),
      txnId:        ourInv?.id ?? (txnQboId ? `qbo:${txnQboId}` : ""),
      qboId:        txnQboId ?? null,
      txnDate:      String(txnDate || ""),
      dueDate:      String(effectiveDueDate || ""),
      originalAmount: openBalance, // QBO's detail report doesn't give us original; use open
      applied:      [],
      totalApplied: 0,
      openBalance,
      daysPastDue:  dpd,
      bucket,
      currency:     ourInv?.currency ?? "EUR",
      flags,
    });
  }

  console.log(`[QBO aging] asOf=${asOf} leafRows=${leafRowCount} detailRowsKept=${detail.length} customers=${new Set(detail.map(d => d.customerId)).size}`);

  if (leafRowCount === 0) {
    // Could be column-name mismatch, or genuinely no open AR. Look at columns.
    const colTitles = (report?.Columns?.Column || []).map((c: any) => c?.ColTitle).filter(Boolean);
    if (colTitles.length > 0 && (report?.Rows?.Row?.length ?? 0) > 0) {
      throw new Error(`QBO report parsed 0 leaf rows; columns were [${colTitles.join(", ")}] — parser may need a new alias`);
    }
  }

  // Per-customer summary
  const byCustomer = new Map<string, SummaryRow>();
  for (const row of detail) {
    let s = byCustomer.get(row.customerId);
    if (!s) {
      s = {
        customerId:    row.customerId,
        customerQboId: row.customerQboId,
        buckets:       emptyBuckets(),
        total:         0,
      };
      byCustomer.set(row.customerId, s);
    }
    s.buckets[row.bucket] += row.openBalance;
    s.total               += row.openBalance;
  }
  const summary = [...byCustomer.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  // Grand totals
  const grandTotals = { ...emptyBuckets(), total: 0 };
  for (const s of summary) {
    for (const b of BUCKETS) grandTotals[b] += s.buckets[b];
    grandTotals.total += s.total;
  }

  const negativeCustomerBalances = summary
    .filter(s => s.total < -0.005)
    .map(s => s.customerId);

  return {
    asOf,
    detail,
    summary,
    grandTotals,
    flags: {
      missingDueDate,
      negativeCustomerBalances,
      unappliedCredits: detail.filter(r => r.txnType === "Credit Memo" && r.openBalance < 0).length,
      voidedSuspected: 0, // QBO already excludes voided txns from the report
    },
    meta: {
      invoiceCount,
      creditMemoCount,
      paymentCount: 0,         // not surfaced by the QBO detail report
      applicationCount: 0,
    } as any,
  };
}
