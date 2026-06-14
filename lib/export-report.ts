/**
 * Excel export for all report types.
 * Pure functions — no React, no side effects.
 * Call exportArReport() or exportSalesReport() then trigger download.
 */
import * as XLSX from "xlsx";

// ─── helpers ───────────────────────────────────────────────────────────────

function isCreditMemo(inv: any): boolean {
  return inv.txnType === "CreditMemo" || String(inv.qboId || "").startsWith("CM-");
}

function daysOverdueAt(dueDate: string, asAt: Date): number {
  return Math.floor((asAt.getTime() - new Date(dueDate).getTime()) / 86400000);
}

/** Open balance of an invoice relative to a given as-at date. */
function openBalance(inv: any, asAt: Date, asAtStr: string, todayStr: string): number {
  const isHistorical = asAtStr !== todayStr;

  if (isCreditMemo(inv)) {
    const bal = Number(inv.qboBalance ?? 0);
    return bal < 0 ? bal : 0; // only unapplied credits (negative) count
  }

  if (!isHistorical && (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off")) return 0;
  if (isHistorical && inv.paidAt && inv.paidAt <= asAtStr) return 0;

  if (isHistorical && inv.paidAt && inv.paidAt > asAtStr) {
    return Number(inv.total); // was fully outstanding on that date
  }
  return inv.qboBalance != null
    ? Number(inv.qboBalance)
    : Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));
}

type Buckets = { Current: number; "1-30": number; "31-60": number; "61-90": number; "90+": number; total: number };

function emptyBuckets(): Buckets {
  return { Current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 };
}

function calcBuckets(inv: any, asAt: Date, asAtStr: string, todayStr: string): Buckets {
  const b = emptyBuckets();
  const bal = openBalance(inv, asAt, asAtStr, todayStr);
  if (bal === 0) return b;

  if (isCreditMemo(inv)) {
    b.Current = bal;
    b.total   = bal;
    return b;
  }

  const days = daysOverdueAt(inv.dueDate, asAt);
  if      (days <= 0)  b.Current  = bal;
  else if (days <= 30) b["1-30"]  = bal;
  else if (days <= 60) b["31-60"] = bal;
  else if (days <= 90) b["61-90"] = bal;
  else                 b["90+"]   = bal;
  b.total = bal;
  return b;
}

function addBuckets(a: Buckets, b: Buckets): Buckets {
  return {
    Current:  a.Current  + b.Current,
    "1-30":   a["1-30"]  + b["1-30"],
    "31-60":  a["31-60"] + b["31-60"],
    "61-90":  a["61-90"] + b["61-90"],
    "90+":    a["90+"]   + b["90+"],
    total:    a.total    + b.total,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function netAmount(inv: any): number {
  const base = Math.abs(Number(inv.amount || 0));
  return isCreditMemo(inv) ? -base : base;
}

// ─── AR reports ────────────────────────────────────────────────────────────

export type ArExportInput = {
  reportId: "aging-customer" | "aging-project" | "regional" | "by-rep";
  reportLabel: string;
  orgName: string;
  asAtDate: string;
  invoices: any[];
  customers: any[];
  projects: any[];
  regions?: any[];
  reps?: any[];
  regionFilter?: string;
};

export function exportArReport(opts: ArExportInput) {
  const { reportId, reportLabel, orgName, asAtDate, invoices, customers, projects, regions, reps, regionFilter } = opts;
  const todayStr = new Date().toISOString().slice(0, 10);
  const asAt = new Date(asAtDate + "T23:59:59");

  // ── Filter invoices ────────────────────────────────────────────────────
  const filtered = invoices.filter(inv => {
    if (asAtDate < todayStr && inv.invoiceDate > asAtDate) return false;
    if (asAtDate < todayStr && inv.paidAt && inv.paidAt <= asAtDate) return false;
    if (asAtDate === todayStr && (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off")) return false;
    if (isCreditMemo(inv) && (inv.qboBalance ?? 0) >= 0) return false;
    if (!isCreditMemo(inv)) {
      const bal = inv.qboBalance != null ? Number(inv.qboBalance) : Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));
      if (bal <= 0 && asAtDate === todayStr) return false;
    }
    // region filter
    if (regionFilter) {
      const cust = customers.find((c: any) => c.id === inv.customerId);
      const proj = projects.find((p: any) => p.id === inv.projectId);
      if (cust?.regionId !== regionFilter && proj?.regionId !== regionFilter) return false;
    }
    return true;
  });

  const wb = XLSX.utils.book_new();
  const meta = [
    ["Report:", reportLabel],
    ["Organisation:", orgName],
    ["As at:", asAtDate],
    ["Exported:", new Date().toISOString().slice(0, 19).replace("T", " ")],
    [],
  ];

  // ── Summary sheet ──────────────────────────────────────────────────────
  const BUCKET_COLS = ["Current", "1–30 days", "31–60 days", "61–90 days", "91+ days", "Total Outstanding"];

  if (reportId === "aging-customer") {
    const custMap = new Map<string, { name: string; buckets: Buckets; currencies: Set<string> }>();
    for (const inv of filtered) {
      const cust = customers.find((c: any) => c.id === inv.customerId);
      if (!cust) continue;
      if (!custMap.has(cust.id)) custMap.set(cust.id, { name: cust.name, buckets: emptyBuckets(), currencies: new Set() });
      const row = custMap.get(cust.id)!;
      row.buckets = addBuckets(row.buckets, calcBuckets(inv, asAt, asAtDate, todayStr));
      if (inv.currency) row.currencies.add(inv.currency);
    }
    const summaryRows = Array.from(custMap.values())
      .filter(r => r.buckets.total !== 0)
      .sort((a, b) => b.buckets.total - a.buckets.total);

    const headers = ["Customer", ...BUCKET_COLS, "Currency"];
    const rows = summaryRows.map(r => [
      r.name,
      round2(r.buckets.Current), round2(r.buckets["1-30"]), round2(r.buckets["31-60"]),
      round2(r.buckets["61-90"]), round2(r.buckets["90+"]), round2(r.buckets.total),
      [...r.currencies].join(" / ") || "—",
    ]);
    // Totals row
    const totBuckets = summaryRows.reduce((acc, r) => addBuckets(acc, r.buckets), emptyBuckets());
    rows.push(["TOTAL", round2(totBuckets.Current), round2(totBuckets["1-30"]), round2(totBuckets["31-60"]),
      round2(totBuckets["61-90"]), round2(totBuckets["90+"]), round2(totBuckets.total), ""]);
    appendSheet(wb, "Summary", [...meta, headers, ...rows]);
  }

  if (reportId === "aging-project") {
    const projMap = new Map<string, { name: string; customer: string; buckets: Buckets; currencies: Set<string> }>();
    for (const inv of filtered) {
      const proj = inv.projectId ? projects.find((p: any) => p.id === inv.projectId) : null;
      const cust = customers.find((c: any) => c.id === inv.customerId);
      const key = proj?.id ?? `__unassigned__${inv.customerId}`;
      const name = proj?.name ?? "— No project —";
      if (!projMap.has(key)) projMap.set(key, { name, customer: cust?.name ?? "—", buckets: emptyBuckets(), currencies: new Set() });
      const row = projMap.get(key)!;
      row.buckets = addBuckets(row.buckets, calcBuckets(inv, asAt, asAtDate, todayStr));
      if (inv.currency) row.currencies.add(inv.currency);
    }
    const summaryRows = Array.from(projMap.values()).filter(r => r.buckets.total !== 0).sort((a, b) => b.buckets.total - a.buckets.total);
    const headers = ["Project", "Customer", ...BUCKET_COLS, "Currency"];
    const rows = summaryRows.map(r => [
      r.name, r.customer,
      round2(r.buckets.Current), round2(r.buckets["1-30"]), round2(r.buckets["31-60"]),
      round2(r.buckets["61-90"]), round2(r.buckets["90+"]), round2(r.buckets.total),
      [...r.currencies].join(" / ") || "—",
    ]);
    const totBuckets = summaryRows.reduce((acc, r) => addBuckets(acc, r.buckets), emptyBuckets());
    rows.push(["TOTAL", "", round2(totBuckets.Current), round2(totBuckets["1-30"]), round2(totBuckets["31-60"]),
      round2(totBuckets["61-90"]), round2(totBuckets["90+"]), round2(totBuckets.total), ""]);
    appendSheet(wb, "Summary", [...meta, headers, ...rows]);
  }

  if (reportId === "regional") {
    const regionMap = new Map<string, { name: string; customers: Set<string>; invCount: number; buckets: Buckets; currencies: Set<string> }>();
    for (const inv of filtered) {
      const cust = customers.find((c: any) => c.id === inv.customerId);
      const proj = projects.find((p: any) => p.id === inv.projectId);
      const regId = cust?.regionId || proj?.regionId || null;
      const regName = (regions ?? []).find((r: any) => r.id === regId)?.name || "Other";
      if (!regionMap.has(regName)) regionMap.set(regName, { name: regName, customers: new Set(), invCount: 0, buckets: emptyBuckets(), currencies: new Set() });
      const row = regionMap.get(regName)!;
      row.customers.add(inv.customerId);
      row.invCount++;
      row.buckets = addBuckets(row.buckets, calcBuckets(inv, asAt, asAtDate, todayStr));
      if (inv.currency) row.currencies.add(inv.currency);
    }
    const summaryRows = Array.from(regionMap.values()).filter(r => r.buckets.total !== 0).sort((a, b) => b.buckets.total - a.buckets.total);
    const grandTotal = summaryRows.reduce((acc, r) => acc + r.buckets.total, 0);
    const headers = ["Region", "Customers", "Invoices", ...BUCKET_COLS, "% of Total", "Currency"];
    const rows = summaryRows.map(r => [
      r.name, r.customers.size, r.invCount,
      round2(r.buckets.Current), round2(r.buckets["1-30"]), round2(r.buckets["31-60"]),
      round2(r.buckets["61-90"]), round2(r.buckets["90+"]), round2(r.buckets.total),
      grandTotal > 0 ? `${(r.buckets.total / grandTotal * 100).toFixed(1)}%` : "—",
      [...r.currencies].join(" / ") || "—",
    ]);
    const totBuckets = summaryRows.reduce((acc, r) => addBuckets(acc, r.buckets), emptyBuckets());
    rows.push(["TOTAL",
      new Set(summaryRows.flatMap(r => [...r.customers])).size,
      summaryRows.reduce((s, r) => s + r.invCount, 0),
      round2(totBuckets.Current), round2(totBuckets["1-30"]), round2(totBuckets["31-60"]),
      round2(totBuckets["61-90"]), round2(totBuckets["90+"]), round2(totBuckets.total), "100%", ""]);
    appendSheet(wb, "Summary", [...meta, headers, ...rows]);
  }

  if (reportId === "by-rep") {
    const repMap = new Map<string, { name: string; customers: Set<string>; invCount: number; buckets: Buckets; currencies: Set<string> }>();
    for (const inv of filtered) {
      const cust = customers.find((c: any) => c.id === inv.customerId);
      const proj = projects.find((p: any) => p.id === inv.projectId);
      const repId = cust?.repId || proj?.repId || "unassigned";
      const rep = (reps ?? []).find((r: any) => r.id === repId);
      const repName = rep?.name || "Unassigned";
      if (!repMap.has(repId)) repMap.set(repId, { name: repName, customers: new Set(), invCount: 0, buckets: emptyBuckets(), currencies: new Set() });
      const row = repMap.get(repId)!;
      row.customers.add(inv.customerId);
      row.invCount++;
      row.buckets = addBuckets(row.buckets, calcBuckets(inv, asAt, asAtDate, todayStr));
      if (inv.currency) row.currencies.add(inv.currency);
    }
    const summaryRows = Array.from(repMap.values()).filter(r => r.buckets.total !== 0).sort((a, b) => b.buckets.total - a.buckets.total);
    const grandTotal = summaryRows.reduce((acc, r) => acc + r.buckets.total, 0);
    const headers = ["Rep", "Customers", "Invoices", ...BUCKET_COLS, "% of Total", "Currency"];
    const rows = summaryRows.map(r => [
      r.name, r.customers.size, r.invCount,
      round2(r.buckets.Current), round2(r.buckets["1-30"]), round2(r.buckets["31-60"]),
      round2(r.buckets["61-90"]), round2(r.buckets["90+"]), round2(r.buckets.total),
      grandTotal > 0 ? `${(r.buckets.total / grandTotal * 100).toFixed(1)}%` : "—",
      [...r.currencies].join(" / ") || "—",
    ]);
    const totBuckets = summaryRows.reduce((acc, r) => addBuckets(acc, r.buckets), emptyBuckets());
    rows.push(["TOTAL",
      new Set(summaryRows.flatMap(r => [...r.customers])).size,
      summaryRows.reduce((s, r) => s + r.invCount, 0),
      round2(totBuckets.Current), round2(totBuckets["1-30"]), round2(totBuckets["31-60"]),
      round2(totBuckets["61-90"]), round2(totBuckets["90+"]), round2(totBuckets.total), "100%", ""]);
    appendSheet(wb, "Summary", [...meta, headers, ...rows]);
  }

  // ── Invoice Detail sheet (common to all AR reports) ────────────────────
  const detailHeaders = [
    "Invoice #", "Customer", "Project", "Invoice Date", "Due Date",
    "Currency", "Current", "1–30 days", "31–60 days", "61–90 days", "91+ days",
    "Outstanding", "Collection Stage", "Type",
  ];
  const detailRows = filtered
    .map(inv => {
      const b = calcBuckets(inv, asAt, asAtDate, todayStr);
      if (b.total === 0) return null;
      const cust = customers.find((c: any) => c.id === inv.customerId);
      const proj = projects.find((p: any) => p.id === inv.projectId);
      return [
        inv.invoiceNumber, cust?.name ?? "—", proj?.name ?? "—",
        inv.invoiceDate, inv.dueDate,
        inv.currency || "EUR",
        round2(b.Current), round2(b["1-30"]), round2(b["31-60"]),
        round2(b["61-90"]), round2(b["90+"]), round2(b.total),
        inv.collectionStage ?? "—",
        isCreditMemo(inv) ? "Credit Note" : "Invoice",
      ];
    })
    .filter(Boolean)
    .sort((a: any, b: any) => (b[11] as number) - (a[11] as number)); // sort by outstanding desc
  appendSheet(wb, "Invoice Detail", [...meta, detailHeaders, ...detailRows as any[][]]);

  // ── Trigger download ───────────────────────────────────────────────────
  const filename = `${reportLabel.replace(/\s+/g, "-")}_${asAtDate}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ─── Sales reports ─────────────────────────────────────────────────────────

export type SalesExportInput = {
  reportId: string;
  reportLabel: string;
  orgName: string;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  invoices: any[];
  customers: any[];
  projects: any[];
  regions?: any[];
  reps?: any[];
  breakdown: "customer" | "project" | "rep" | "region";
};

export function exportSalesReport(opts: SalesExportInput) {
  const { reportId, reportLabel, orgName, periodLabel, periodFrom, periodTo, invoices, customers, projects, regions, reps, breakdown } = opts;
  const wb = XLSX.utils.book_new();

  const from = new Date(periodFrom + "T00:00:00");
  const to   = new Date(periodTo   + "T23:59:59");

  const meta = [
    ["Report:", reportLabel],
    ["Organisation:", orgName],
    ["Period:", `${periodLabel} (${periodFrom} – ${periodTo})`],
    ["Exported:", new Date().toISOString().slice(0, 19).replace("T", " ")],
    [],
  ];

  const periodItems = invoices.filter((i: any) => {
    const d = new Date(i.invoiceDate);
    return d >= from && d <= to;
  });

  // ── Breakdown sheet ────────────────────────────────────────────────────
  type BdRow = { label: string; gross: number; cnAdj: number; net: number; invCount: number; cnCount: number; currency: Set<string> };
  const bdMap = new Map<string, BdRow>();
  for (const inv of periodItems) {
    let key = "", label = "";
    if (breakdown === "customer") {
      const c = customers.find((c: any) => c.id === inv.customerId);
      key = inv.customerId || "unknown"; label = c?.name || "Unknown";
    } else if (breakdown === "project") {
      const p = projects.find((p: any) => p.id === inv.projectId);
      key = inv.projectId || "no-project"; label = p?.name || "No Project";
    } else if (breakdown === "rep") {
      const c = customers.find((c: any) => c.id === inv.customerId);
      const p = projects.find((p: any) => p.id === inv.projectId);
      const repId = c?.repId || p?.repId || "unassigned";
      const rep = (reps ?? []).find((r: any) => r.id === repId);
      key = repId; label = rep?.name || "Unassigned";
    } else {
      const c = customers.find((c: any) => c.id === inv.customerId);
      const p = projects.find((p: any) => p.id === inv.projectId);
      const regId = c?.regionId || p?.regionId || "none";
      const reg = (regions ?? []).find((r: any) => r.id === regId);
      key = regId; label = reg?.name || "No Region";
    }
    if (!bdMap.has(key)) bdMap.set(key, { label, gross: 0, cnAdj: 0, net: 0, invCount: 0, cnCount: 0, currency: new Set() });
    const row = bdMap.get(key)!;
    const amt = netAmount(inv);
    row.net += amt;
    if (inv.currency) row.currency.add(inv.currency);
    if (isCreditMemo(inv)) { row.cnAdj += amt; row.cnCount++; }
    else { row.gross += amt; row.invCount++; }
  }
  const bdRows = Array.from(bdMap.values()).sort((a, b) => b.net - a.net);
  const totalNet = bdRows.reduce((s, r) => s + r.net, 0);
  const bdHeaders = [
    breakdown.charAt(0).toUpperCase() + breakdown.slice(1),
    "Gross Revenue", "Credit Note Adj.", "Net Revenue",
    "Invoices", "Credit Notes", "Avg Invoice", "% of Total", "Currency",
  ];
  const bdData = bdRows.map(r => [
    r.label,
    round2(r.gross), round2(Math.abs(r.cnAdj)), round2(r.net),
    r.invCount, r.cnCount,
    r.invCount > 0 ? round2(r.gross / r.invCount) : 0,
    totalNet > 0 ? `${(r.net / totalNet * 100).toFixed(1)}%` : "—",
    [...r.currency].join(" / ") || "—",
  ]);
  const totRow = [
    "TOTAL",
    round2(bdRows.reduce((s, r) => s + r.gross, 0)),
    round2(Math.abs(bdRows.reduce((s, r) => s + r.cnAdj, 0))),
    round2(totalNet),
    bdRows.reduce((s, r) => s + r.invCount, 0),
    bdRows.reduce((s, r) => s + r.cnCount, 0),
    "", "100%", "",
  ];
  appendSheet(wb, "Breakdown", [...meta, bdHeaders, ...bdData, totRow]);

  // ── Monthly trend sheet ────────────────────────────────────────────────
  const now = new Date();
  const trendHeaders = ["Month", "This Year", "Prior Year", "YoY Change", "YoY %"];
  const trendData: any[][] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const pd = new Date(now.getFullYear() - 1, now.getMonth() - i, 1);
    const priorKey = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`;
    const net   = invoices.filter((inv: any) => inv.invoiceDate?.slice(0, 7) === key).reduce((s: number, inv: any) => s + netAmount(inv), 0);
    const prior = invoices.filter((inv: any) => inv.invoiceDate?.slice(0, 7) === priorKey).reduce((s: number, inv: any) => s + netAmount(inv), 0);
    const change = net - prior;
    const changePct = prior > 0 ? (change / prior * 100) : null;
    trendData.push([
      d.toLocaleString("default", { month: "short", year: "numeric" }),
      round2(net), round2(prior), round2(change),
      changePct !== null ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%` : "—",
    ]);
  }
  appendSheet(wb, "Monthly Trend", [...meta, trendHeaders, ...trendData]);

  // ── Invoice list sheet ─────────────────────────────────────────────────
  const invHeaders = [
    "Invoice #", "Customer", "Project", "Invoice Date", "Due Date", "Currency",
    "Gross Amount", "Type", "Payment Status",
  ];
  const invData = periodItems.map((inv: any) => {
    const cust = customers.find((c: any) => c.id === inv.customerId);
    const proj = projects.find((p: any) => p.id === inv.projectId);
    return [
      inv.invoiceNumber, cust?.name ?? "—", proj?.name ?? "—",
      inv.invoiceDate, inv.dueDate, inv.currency || "EUR",
      round2(Math.abs(inv.amount || 0)),
      isCreditMemo(inv) ? "Credit Note" : "Invoice",
      inv.paymentStatus ?? "—",
    ];
  }).sort((a: any, b: any) => (String(b[3]) > String(a[3]) ? 1 : -1));
  appendSheet(wb, "Invoice List", [...meta, invHeaders, ...invData]);

  const filename = `${reportLabel.replace(/\s+/g, "-")}_${periodFrom}_${periodTo}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ─── util ──────────────────────────────────────────────────────────────────

function appendSheet(wb: XLSX.WorkBook, name: string, data: any[][]) {
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Auto-width: find max char length per column
  const colWidths: number[] = [];
  for (const row of data) {
    if (!Array.isArray(row)) continue;
    row.forEach((cell, i) => {
      const len = String(cell ?? "").length;
      colWidths[i] = Math.max(colWidths[i] || 0, len);
    });
  }
  ws["!cols"] = colWidths.map(w => ({ wch: Math.min(Math.max(w + 2, 8), 50) }));

  XLSX.utils.book_append_sheet(wb, ws, name);
}
