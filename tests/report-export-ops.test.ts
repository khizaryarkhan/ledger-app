import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseReportModel } from "@/lib/reports/export-schema";
import type { ReportExportModel } from "@/lib/reports/export-model";
import { buildStockValuationSummaryModel, buildStockValuationLotsModel, buildStockStatusModel } from "@/lib/reports/builders/stock";
import { buildDeliveryRiskModel } from "@/lib/reports/builders/delivery-risk";
import { buildDeliveryPerformanceModel } from "@/lib/reports/builders/delivery-performance";
import { buildJobWorkYieldModel } from "@/lib/reports/builders/jobwork-yield";
import { buildProductionPerformanceModel } from "@/lib/reports/builders/production-performance";
import { buildLotTraceabilityModel } from "@/lib/reports/builders/lot-traceability";
import { dateCell } from "@/lib/reports/builders/ops-common";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const info = { entity: "Acme Ltd", currency: "EUR", search: "" };

function valid(m: ReportExportModel) {
  const r = parseReportModel(m);
  expect(r.ok, r.ok ? "" : (r as { error: string }).error).toBe(true);
}
const lines = (m: ReportExportModel, s = 0) => m.sections[s].rows.filter((r) => r.kind === "line");
const totals = (m: ReportExportModel, s = 0) => m.sections[s].rows.filter((r) => r.kind === "total");

describe("date cells", () => {
  it("keeps a plain or midnight date as the literal and never builds a Date for it", () => {
    expect(dateCell("2026-11-03")).toBe("2026-11-03");
    expect(dateCell("2026-11-03T00:00:00.000Z")).toBe("2026-11-03");
    expect(dateCell(null)).toBeNull();
    expect(dateCell("")).toBeNull();
  });
});

describe("Stock Valuation", () => {
  const rows = [
    { id: "1", name: "Chicken", code: "CH", category: "Raw", onHandQty: 840, baseUom: "oz", avgCost: 0.5, value: 420 },
    { id: "2", name: "Salt", code: null, category: null, onHandQty: 497.6, baseUom: "g", avgCost: 1.2345, value: 614.28 },
  ];
  it("summary lists the shown rows and ties the total to the API total", () => {
    const m = buildStockValuationSummaryModel({ rows, total: 1034.28 }, rows, info);
    valid(m);
    expect(lines(m)).toHaveLength(2);
    expect(totals(m)[0].cells[6]).toBe(1034.28);
    expect(lines(m)[1].cells).toEqual(["Salt", null, null, 497.6, "g", 1.2345, 614.28]);
    expect(m.notes).toEqual([]);
  });
  it("summary: a filtered list says so and still carries the all-items total", () => {
    const m = buildStockValuationSummaryModel({ rows, total: 1034.28 }, [rows[0]], { ...info, search: "chi" });
    expect(lines(m)).toHaveLength(1);
    expect(m.notes[0]).toMatch(/1 of 2 items/);
    expect(m.params.find((p) => p.label === "Search")?.value).toBe("chi");
  });
  it("summary: empty has no total row", () => {
    const m = buildStockValuationSummaryModel({ rows: [], total: 0 }, [], info);
    valid(m);
    expect(m.sections[0].rows).toHaveLength(0);
  });
  it("by-lot: total is the sum of the searched lots, base lots read 'base', packs use the pack unit, locations match the screen", () => {
    const lots = [
      { id: "abcdefghij", itemName: "Rice", skuName: null, lotNo: "L1", expiryDate: "2027-01-31", locations: [{ code: "MAIN", qty: 5 }], remainingQty: 5, baseUom: "kg", unitCost: 2, value: 10 },
      { id: "k", itemName: "Rice", skuName: "1kg bag", lotNo: null, expiryDate: null, locations: [{ code: "A", qty: 2 }, { code: "B", qty: 3 }], packs: 5, packType: "bag", remainingQty: 5, unitCost: 2, value: 10.5 },
    ];
    const m = buildStockValuationLotsModel(lots, lots, info);
    valid(m);
    expect(totals(m)[0].cells[8]).toBe(20.5);
    const [a, b] = lines(m);
    expect(a.cells.slice(0, 7)).toEqual(["Rice", "base", "L1", "2027-01-31", "MAIN", 5, "kg"]);
    expect(b.cells[1]).toBe("1kg bag");
    expect(b.cells[2]).toBe("k");
    expect(b.cells[4]).toBe("A 2 · B 3");
    expect(b.cells[6]).toBe("bag");
  });
  it("by-lot: column-filtered rows are listed but the total stays the searched total (as on screen)", () => {
    const lots = [{ id: "1", itemName: "A", value: 10 }, { id: "2", itemName: "B", value: 5 }];
    const m = buildStockValuationLotsModel(lots, [lots[0]], info);
    expect(lines(m)).toHaveLength(1);
    expect(totals(m)[0].cells[8]).toBe(15);
    expect(m.notes[0]).toMatch(/1 of 2 lots/);
  });
});

describe("Stock Status", () => {
  const all = [
    { id: "1", name: "Chicken", code: "CH", onHandQty: 0, baseUom: "oz", byLocation: [], expectedQty: 10, committedQty: 4, allocatedQty: 0, availableQty: 6, minOhQty: 5, out: true, belowMin: true },
    { id: "2", name: "Salt", code: "S", onHandQty: 9, baseUom: "g", byLocation: [{ code: "MAIN", qty: 9 }], expectedQty: 0, committedQty: 0, allocatedQty: 2, availableQty: 7, minOhQty: 1, out: false, belowMin: false },
  ];
  it("blank/negative rules match the screen and the status is flagged only when it is an exception", () => {
    const m = buildStockStatusModel(all, all, { ...info, onlyAttention: false });
    valid(m);
    const [a, b] = lines(m);
    expect(a.cells.slice(5, 11)).toEqual([10, -4, null, 6, 5, "Out of stock"]);
    expect(a.flags![10]).toBe(true);
    expect(b.cells.slice(5, 11)).toEqual([null, null, -2, 7, 1, "OK"]);
    expect(b.cells[4]).toBe("MAIN");
    expect(b.flags!.some(Boolean)).toBe(false);
  });
  it("names the attention filter and the filtered count", () => {
    const m = buildStockStatusModel(all, [all[0]], { ...info, onlyAttention: true });
    expect(m.params.some((p) => p.label === "Only items needing attention")).toBe(true);
    expect(m.notes[0]).toMatch(/1 of 2/);
  });
  it("empty is valid", () => valid(buildStockStatusModel([], [], info)));
});

describe("Delivery Risk", () => {
  it("groups by sales order in first-seen order and flags critical", () => {
    const alerts = [
      { id: "1", salesOrderId: "so1", salesOrderDocNumber: "SO-1", sourceType: "po", sourceDocNumber: "PO-1", severity: "critical", message: "5 days late" },
      { id: "2", salesOrderId: null, sourceType: "mo", sourceDocNumber: "MO-1", severity: "warning", message: "2 days" },
      { id: "3", salesOrderId: "so1", salesOrderDocNumber: "SO-1", sourceType: "jobwork", sourceDocNumber: "JW-1", severity: "warning", message: "1 day" },
    ];
    const m = buildDeliveryRiskModel(alerts, { entity: "Acme" });
    valid(m);
    const r = lines(m);
    expect(r.map((x) => x.cells[2])).toEqual(["PO-1", "JW-1", "MO-1"]);
    expect(r[2].cells[0]).toBe("Not linked to a Sales Order");
    expect(r[0].cells[1]).toBe("Purchase Order");
    expect(r[0].cells[3]).toBe("Critical");
    expect(m.notes[0]).toMatch(/3 steps at risk across 2 groups/);
  });
  it("empty states that nothing is at risk", () => {
    const m = buildDeliveryRiskModel([], { entity: "Acme" });
    valid(m);
    expect(m.sections[0].rows).toHaveLength(0);
    expect(m.notes[0]).toMatch(/Nothing at risk/);
  });
});

describe("Delivery Performance", () => {
  const line = (over: object) => ({
    lineId: "l", docNumber: "PO-1", partyRef: "R1", partyLabel: "Acme Supplies", item: "Flour", requestedDate: "2026-10-01", promisedDate: "2026-10-05",
    originalPromisedDate: "2026-10-03", promiseRevisions: 1, orderedQty: 10, deliveredQty: 8, lastDelivery: "2026-10-09", state: "Overdue", daysLate: 4, ...over,
  });
  const data = {
    overall: { otifPct: 70, onTimePct: 90, onTimeVsOriginalPct: 96, inFullPct: 80, overdue: 2, avgLeadTimeDays: 5.5 },
    parties: [{ partyId: "p", partyLabel: "Acme Supplies", lines: 4, otifPct: 70, onTimePct: 90, onTimeVsOriginalPct: 96, inFullPct: 80, avgDaysLate: 1.5, avgLeadTimeDays: 5, overdue: 2, revisedLines: 1, unconfirmedOrders: 0 }],
    lines: [line({}), line({ lineId: "m", state: "Delivered", daysLate: 0, promiseRevisions: 0 })],
  };
  const base = { side: "supplier" as const, entity: "Acme", periodLine: "Orders from X to Y", from: "2026-10-01", to: "2026-11-01", party: "", show: "exceptions" as const };
  it("scores, parties and shown lines; flags exceptions only", () => {
    const m = buildDeliveryPerformanceModel(data, [data.lines[0]], base);
    valid(m);
    expect(m.sections).toHaveLength(3);
    expect(m.sections[0].rows[0].cells).toEqual([70, 90, 96, 80, 2, 5.5]);
    expect(m.sections[0].rows[0].flags).toEqual([true, true, false, true, true, false]);
    expect(m.sections[1].rows).toHaveLength(1);
    const l = m.sections[2].rows[0];
    expect(l.cells[5]).toBe("2026-10-05");
    expect(l.cells[6]).toBe("2026-10-03");
    expect(l.cells[9]).toBe(8);
    expect(l.flags![12]).toBe(true);
    expect(m.notes[0]).toMatch(/1 of 2 lines/);
    expect(m.title).toBe("Delivery Performance — Suppliers");
  });
  it("customer side relabels, a line with no re-promise has no 'first promised' date, and no overall means no score section", () => {
    const m = buildDeliveryPerformanceModel({ parties: [], lines: [line({ promiseRevisions: 0 })] }, [line({ promiseRevisions: 0 })], { ...base, side: "customer", party: "Bob", show: "all" });
    valid(m);
    expect(m.sections).toHaveLength(2);
    expect(m.sections[0].columns[0].label).toBe("Customer");
    expect(m.sections[1].rows[0].cells[6]).toBeNull();
    expect(m.params.some((p) => p.label === "Customer" && p.value === "Bob")).toBe(true);
  });
  it("explains blank on-time figures", () => {
    const d = { overall: { onTimePct: null, otifPct: null }, parties: [], lines: [line({})] };
    expect(buildDeliveryPerformanceModel(d, d.lines, base).notes.join(" ")).toMatch(/blank because none/);
  });
  it("empty parties and lines are valid", () => valid(buildDeliveryPerformanceModel({ parties: [], lines: [] }, [], base)));
});

describe("Subcontractor Yield", () => {
  const data = {
    vendors: [{
      vendorId: "v", vendorLabel: "Knit Co", orderCount: 2, totalSentQty: 100, totalReceivedQty: 90, actualYieldPct: 90, avgExpectedYieldPct: 95, totalWastageAmount: 55.5,
      orders: [{ id: "o", docNumber: "JW-1", closedAt: "2026-10-04T12:00:00Z", sentQty: 100, receivedQty: 90, actualYieldPct: 90, expectedYieldPct: 95, wastageAmount: 55.5 }],
    }],
    grandTotal: { orderCount: 2, totalSentQty: 100, totalReceivedQty: 90, totalWastageAmount: 55.5 },
  };
  it("vendor row, indented order rows, variance flagged when negative, totals tie to the grand total", () => {
    const m = buildJobWorkYieldModel(data, info);
    valid(m);
    const r = m.sections[0].rows;
    expect(r[0].cells.slice(4, 8)).toEqual([90, 95, -5, 55.5]);
    expect(r[0].flags![6]).toBe(true);
    expect(r[1].indent).toBe(1);
    expect(r[1].cells[0]).toBe("JW-1 · closed 2026-10-04");
    expect(r[2].kind).toBe("total");
    expect(r[2].cells[7]).toBe(55.5);
    expect(r[2].cells[0]).toBe("Total (2 closed orders)");
  });
  it("no expected yield leaves variance blank; empty has no total", () => {
    const m = buildJobWorkYieldModel({ vendors: [{ ...data.vendors[0], avgExpectedYieldPct: null, orders: [] }], grandTotal: data.grandTotal }, info);
    expect(m.sections[0].rows[0].cells[6]).toBeNull();
    const e = buildJobWorkYieldModel({ vendors: [] }, info);
    valid(e);
    expect(e.sections[0].rows).toHaveLength(0);
    expect(e.notes[0]).toMatch(/No closed job-work orders/);
  });
});

describe("Production Performance", () => {
  const timing = { orders: 3, scored: 3, onTimePct: 66.7, onTimeVsOriginalPct: 50, avgDaysLate: 2, overdue: 1, rescheduled: 1, avgStartSlip: 0 };
  const pareto = [{ code: "unrecorded", label: "Not recorded", count: 2, value: 2 }, { code: "supplier", label: "Supplier", count: 1, value: 1 }];
  const data = {
    production: {
      timing, yieldPct: 97, goodQty: 90, rejectedQty: 3, scrapCost: 12.5, hours: [{ workCentre: "Mixer", actual: 5, planned: 4, efficiencyPct: 80 }],
      delayReasons: pareto, scrapReasons: [{ code: "burnt", label: "Burnt", count: 1, value: 3 }],
      orders: [{ id: "m", moNo: "MO-1", item: "Bread", status: "Completed", timing: "Late", plannedStart: "2026-10-01", actualStart: "2026-10-02T09:30:00Z", due: "2026-10-05", originalDue: "2026-10-03", finish: "2026-10-08", daysLate: 3, reschedules: 1, delayReason: null, delayNote: null }],
    },
    downtime: { totalMinutes: 90, unplannedMinutes: 30, stops: 2, open: 1, reasons: [{ code: "breakdown", label: "Breakdown", count: 1, value: 30 }], byWorkCentre: [{ workCentre: "Mixer", minutes: 90, unplanned: 30, stops: 2 }] },
    jobWork: {
      timing, delayReasons: pareto, wastageReasons: [{ code: "x", label: "Lost", count: 1, value: 40.25 }],
      vendors: [{ ...timing, vendor: "Knit Co", orders: 2, yieldPct: 90, wastageValue: 40.25 }],
      orders: [{ id: "j", docNumber: "JW-1", vendor: "Knit Co", status: "Closed", timing: "OnTime", dispatched: "2026-10-01", due: "2026-10-09", originalDue: "2026-10-09", finish: "2026-10-08", daysLate: 0, revisions: 0, delayReason: null, delayNote: null }],
    },
  };
  const base = { entity: "Acme", currency: "EUR", periodLine: "Orders due from A to B", from: "2026-10-01", to: "2026-11-01" };
  it("exports only the tab being shown and names it", () => {
    const p = buildProductionPerformanceModel(data, { ...base, tab: "production" });
    valid(p);
    expect(p.title).toBe("Production Performance — Manufacturing orders");
    expect(p.params[0].value).toBe("Manufacturing orders");
    expect(p.sections.map((s) => s.heading)).toEqual(["Summary", "Why orders were late", "Why output was rejected", "Hours: planned vs actual", "Orders"]);
    const d = buildProductionPerformanceModel(data, { ...base, tab: "downtime" });
    valid(d);
    expect(d.title).toMatch(/Downtime/);
    expect(d.sections[0].rows[0].cells).toEqual([90, 30, 2, 1]);
    const j = buildProductionPerformanceModel(data, { ...base, tab: "jobwork" });
    valid(j);
    expect(j.sections.map((s) => s.heading)).toEqual(["Summary", "Why returns were late", "Why material was lost", "By job worker", "Orders"]);
    expect(j.sections[2].rows[0].cells[1]).toBe(40.25);
  });
  it("production: unrecorded reason and late order are flagged; an unrecorded delay reads 'Not recorded'; dates stay literal; timestamps become text", () => {
    const p = buildProductionPerformanceModel(data, { ...base, tab: "production" });
    expect(p.sections[1].rows[0].flags![0]).toBe(true);
    expect(p.sections[1].rows[1].flags![0]).toBe(false);
    const o = p.sections[4].rows[0];
    expect(o.cells[2]).toBe("2026-10-01");
    expect(typeof o.cells[3]).toBe("string");
    expect(o.cells[3]).not.toBe("2026-10-02T09:30:00Z");
    expect(o.cells[5]).toBe("2026-10-03");
    expect(o.cells[9]).toBe("Not recorded");
    expect(o.cells[10]).toBe("Late");
    expect(p.sections[0].rows[0].cells.slice(0, 2)).toEqual([66.7, 50]);
  });
  it("blank on-time gets a note when orders exist", () => {
    const d = { ...data, production: { ...data.production, timing: { ...timing, onTimePct: null } } };
    expect(buildProductionPerformanceModel(d, { ...base, tab: "production" }).notes[0]).toMatch(/blank/);
  });
  it("empty lists are valid", () => {
    const e = { production: { ...data.production, delayReasons: [], scrapReasons: [], hours: [], orders: [] }, downtime: { ...data.downtime, reasons: [], byWorkCentre: [] }, jobWork: { ...data.jobWork, delayReasons: [], wastageReasons: [], vendors: [], orders: [] } };
    for (const tab of ["production", "downtime", "jobwork"] as const) valid(buildProductionPerformanceModel(e, { ...base, tab }));
  });
});

describe("Lot Traceability", () => {
  const manufactured = {
    lot: { id: "lot-1", itemName: "Bread", lotNo: "L9", sourceType: "production", baseUom: "pc", origQty: 100, remainingQty: 40, unitCost: 2, packs: { qty: 10, label: "box of 10" } },
    rawMaterials: [{ itemName: "Flour", qty: 50, uom: "kg", rate: 2, amount: 100, supplierLabel: "Mill", poNumber: "PO-1", receiptNo: "GRN-1", issuedTo: "MO-1" }],
    processing: [{ orderId: "JW-1", activity: "Bake", qty: 100, uom: "pc", rate: 1, amount: 100, provider: "Oven Co", date: "2026-10-04", orderTotalQty: 200, orderWastagePct: 2 }],
    costRollup: [{ label: "Direct materials", detail: "", amount: 100, sharePct: 50 }, { label: "Conversion", detail: "", amount: 100, sharePct: 50 }, { label: "Total cost", detail: "", amount: 200, sharePct: 100 }],
    ledger: { locations: [{ code: "MAIN", qty: 40 }], difference: 0, computedOnHand: 40, rows: [
      { id: "1", date: "2026-10-04", label: "Production", note: null, docNumber: "BUILD-1", qty: 100, balance: 100, unitCost: 2, value: 200, by: "Ann" },
      { id: "2", date: "2026-10-06", label: "Sale", note: "to Bob", docNumber: "SHP-1", qty: -60, balance: 40, unitCost: 2, value: -120, by: null },
    ] },
    usage: [{ label: "Shipped", date: "2026-10-06", qty: 60, producedLots: [], by: "Ann" }],
    distribution: [{ shipmentNo: "SHP-1", invoiceNo: null, customerLabel: "Bob", itemName: "Bread", lotNo: "L9", qty: 60, uom: "pc", unitPrice: 5, amount: 300, date: "2026-10-06" }],
    operator: "Ann",
  };
  it("lists the sections the screen shows for a manufactured lot, with totals tying and reconciliation passing", () => {
    const m = buildLotTraceabilityModel(manufactured, info);
    valid(m);
    expect(m.sections.map((s) => s.heading)).toEqual([
      "Lot", "1. Raw Material Procurement & Consumption", "2. Subcontract Processing (Job Work)", "3. Cost Rollup Summary", "4. Stock movement", "5. What it became", "6. Outbound Commercial Distribution",
    ]);
    const s0 = m.sections[0].rows[0];
    expect(s0.cells[9]).toBe("PASSED");
    expect(s0.flags![9]).toBe(false);
    expect(s0.cells[7]).toBe(80);
    expect(totals(m, 1)[0].cells[4]).toBe(100);
    expect(totals(m, 2)[0].cells[5]).toBe(100);
    expect(m.sections[3].rows[2].kind).toBe("total");
    expect(m.sections[4].rows[1].cells[4]).toBe(60);
    expect(m.sections[4].rows[1].cells[3]).toBeNull();
    expect(totals(m, 6)[0].cells[7]).toBe(300);
    expect(m.sections[6].rows[0].cells[1]).toBe("Not yet invoiced");
    expect(m.notes.join(" ")).toMatch(/Movements add up/);
  });
  it("a mismatched cost rollup is flagged REVIEW", () => {
    const m = buildLotTraceabilityModel({ ...manufactured, costRollup: [{ label: "Total cost", detail: "", amount: 150, sharePct: 100 }] }, info);
    const c = m.sections[0].rows[0];
    expect(String(c.cells[9])).toMatch(/^REVIEW/);
    expect(c.flags![9]).toBe(true);
  });
  it("a bought lot shows its origin instead of the manufacturing sections; empty parts become notes", () => {
    const bought = {
      lot: { id: "l2", itemName: "Flour", lotNo: "F1", sourceType: "purchase", baseUom: "kg", origQty: 10, remainingQty: 10, unitCost: 1, origin: { supplierLabel: "Mill", poNumber: null, receiptNo: "GRN-2", date: "2026-09-01", qty: 10, unitCost: 1, receivedBy: "Ann" } },
      rawMaterials: [], processing: [], costRollup: [], ledger: { locations: [], difference: 0, computedOnHand: 10, rows: [] }, usage: [], distribution: [],
    };
    const m = buildLotTraceabilityModel(bought, info);
    valid(m);
    expect(m.sections.map((s) => s.heading)).toEqual(["Lot", "1. Where this lot came from"]);
    expect(m.sections[0].rows[0].cells[9]).toBe("Bought at cost");
    expect(m.sections[1].rows[0].cells[1]).toBe("No PO");
    expect(m.notes.join(" ")).toMatch(/No stock movements/);
    expect(m.notes.join(" ")).toMatch(/not yet shipped/);
  });
});

describe("the six components hand their model to the shell and hold it back while stale", () => {
  const files: [string, RegExp[]][] = [
    ["components/stock-reports.tsx", [/exportModel=\{exportModel\}/, /buildStockValuationSummaryModel/, /buildStockStatusModel/, /setFailed\(true\)/]],
    ["components/delivery-risk-report.tsx", [/exportModel=\{exportModel\}/, /buildDeliveryRiskModel/, /setFailed\(true\)/]],
    ["components/delivery-performance-report.tsx", [/exportModel=\{exportModel\}/, /loadedKey !== /, /reqId/]],
    ["components/jobwork-yield-report.tsx", [/exportModel=\{exportModel\}/, /Array\.isArray\(data\.vendors\)/]],
    ["components/production-performance-report.tsx", [/exportModel=\{exportModel\}/, /loadedKey !== /, /reqId/]],
    ["components/lot-traceability-report.tsx", [/exportModel=\{exportModel\}/, /data\.lot\?\.id !== selectedId/]],
  ];
  for (const [rel, res] of files) {
    it(rel, () => { const src = read(rel); for (const re of res) expect(src, `${rel} ${re}`).toMatch(re); });
  }
  it("builders never format money or build dates", () => {
    for (const f of ["stock", "delivery-risk", "delivery-performance", "jobwork-yield", "production-performance", "lot-traceability", "ops-common"]) {
      const src = read(`lib/reports/builders/${f}.ts`).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(src, f).not.toMatch(/new Date\(|Date\.now\(|toISOString|toLocaleDateString|Intl\.NumberFormat/);
      expect(src, f).not.toMatch(/toFixed\(2\)/);
    }
  });
});
