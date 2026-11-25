import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseReportModel } from "@/lib/reports/export-schema";
import { buildTaxLiabilityModel } from "@/lib/reports/builders/tax-liability";
import { buildFxModel, revalueRow } from "@/lib/reports/builders/fx-exposure";
import { buildStockVsGlModel } from "@/lib/reports/builders/stock-vs-gl";
import { buildCreditsAdjustmentsModel } from "@/lib/reports/builders/credits-adjustments";
import { buildItemLedgerModel } from "@/lib/reports/builders/item-ledger";
import { buildItemLedgers } from "@/lib/inventory/item-ledger";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const info = { entity: "Acme", currency: "EUR" };

describe("Tax Liability export", () => {
  const d = { openingBalance: 100, outputTax: 230, inputTax: 50, adjustments: 0, netLiability: 180, closingBalance: 280 };
  const m = buildTaxLiabilityModel(d, { ...info, periodLine: "p", from: "2026-07-01", to: "2026-11-20" });
  it("mirrors the screen rows, with input tax as a deduction and adjustments hidden at zero", () => {
    const cells = m.sections[0].rows.map((r) => r.cells);
    expect(cells.map((c) => c[0])).not.toContain("Adjustments / payments");
    expect(cells.find((c) => String(c[0]).startsWith("Input"))?.[1]).toBe(-50);
    expect(cells[cells.length - 1][1]).toBe(280);
  });
  it("shows adjustments when non-zero and validates against the schema", () => {
    const m2 = buildTaxLiabilityModel({ ...d, adjustments: -20 }, { ...info, periodLine: "p", from: "a", to: "b" });
    expect(m2.sections[0].rows.some((r) => r.cells[0] === "Adjustments / payments")).toBe(true);
    expect(parseReportModel(m).ok).toBe(true);
  });
  it("zero input tax is 0, not blank", () => {
    const m3 = buildTaxLiabilityModel({ ...d, inputTax: 0 }, { ...info, periodLine: "p", from: "a", to: "b" });
    expect(m3.sections[0].rows[2].cells[1]).toBe(0);
  });
});

describe("FX exposure export", () => {
  const data = { home: "EUR", rows: [
    { accountId: "a", accountName: "Debtors", currency: "USD", foreignBalance: 100, homeCarrying: 90, avgRate: 0.9 },
    { accountId: "b", accountName: "Creditors", currency: "GBP", foreignBalance: -50, homeCarrying: -58, avgRate: 1.16 },
  ] };
  it("uses the entered rates, states them, and totals the revaluation", () => {
    const rates = { USD: "1", GBP: "" };
    const shown = data.rows.map((r) => revalueRow(r, rates));
    const m = buildFxModel(data, shown, { entity: "Acme", asOf: "2026-11-20", asOfLine: "As at", rates });
    const rows = m.sections[0].rows;
    expect(rows[0].cells.slice(4)).toEqual([1, 100, 10]);
    expect(rows[1].cells[4]).toBeNull(); // no rate entered
    expect(rows[1].cells[6]).toBe(0); // stays at booked value
    expect(rows[2].cells[6]).toBe(10);
    expect(m.params).toContainEqual({ label: "Rate now USD", value: "1" });
    expect(parseReportModel(m).ok).toBe(true);
  });
  it("notes a filtered view and handles empty", () => {
    const m = buildFxModel(data, [], { entity: "Acme", asOf: "x", asOfLine: "y", rates: {} });
    expect(m.notes.some((n) => n.startsWith("Filtered view"))).toBe(true);
    expect(m.sections[0].rows).toHaveLength(0);
    const empty = buildFxModel({ home: "EUR", rows: [] }, [], { entity: "A", asOf: "x", asOfLine: "y", rates: {} });
    expect(empty.notes.some((n) => n.startsWith("Filtered"))).toBe(false);
  });
});

describe("Stock vs GL export", () => {
  const data = {
    rows: [
      { accountId: "1", accountName: "Raw", accountCode: "1200", groups: ["RM"], stockValue: 100, glBalance: 100, difference: 0 },
      { accountId: "2", accountName: "FG", accountCode: null, groups: [], stockValue: 50, glBalance: 40, difference: 10 },
    ],
    wip: [{ accountId: "3", accountName: "WIP", accountCode: null, openOrdersValue: 5, glBalance: 5, difference: 0 }],
    unassignedValue: 7,
  };
  it("totals over all accounts, flags differences, and keeps the unmapped line", () => {
    const m = buildStockVsGlModel(data, data.rows, data.wip, { ...info, asAt: "2026-11-20", asAtLine: "As at" });
    const rows = m.sections[0].rows;
    expect(rows[0].cells[0]).toBe("1200 Raw");
    expect(rows[0].flags?.[4]).toBe(false);
    expect(rows[1].flags?.[4]).toBe(true);
    expect(rows[1].cells[1]).toBeNull();
    expect(rows[2].cells[2]).toBe(7);
    const total = rows[rows.length - 1];
    expect(total.kind).toBe("total");
    expect(total.cells.slice(2)).toEqual([150, 140, 10]);
    expect(parseReportModel(m).ok).toBe(true);
  });
  it("says so when filtered or empty", () => {
    const f = buildStockVsGlModel(data, [data.rows[0]], [], { ...info, asAt: "x", asAtLine: "y" });
    expect(f.notes.join(" ")).toMatch(/Filtered view: 1 of 2/);
    const e = buildStockVsGlModel({ rows: [], wip: [], unassignedValue: 0 }, [], [], { ...info, asAt: "x", asAtLine: "y" });
    expect(e.notes.join(" ")).toMatch(/No inventory accounts are mapped/);
    expect(e.sections[0].rows).toHaveLength(0);
  });
});

describe("Credits & Adjustments export", () => {
  const g = (code: string, amount: number, count: number) => ({ code, label: code === "unrecorded" ? "Not recorded" : code, amount, count });
  const d: any = {
    customerCredits: { count: 3, amount: 300, pctOfSales: 6, byReason: [g("damaged", 200, 2), g("unrecorded", 100, 1)] },
    supplierCredits: { count: 0, amount: 0, pctOfPurchases: null, byReason: [] },
    journals: { count: 2, amount: 0, byReason: [g("accrual", 0, 2)] },
    billCapture: { bills: 10, withReceivedDate: 8, avgLagDays: 9, over7Days: 2 },
    editedAfterPosting: 0,
    lines: [
      { id: "x", type: "CreditNote", docNumber: "CN-1", date: "2026-11-01", amount: 100, reason: null, unrecorded: true, memo: "m", editedAt: "2026-11-02T10:00:00Z" },
      { id: "y", type: "Manual", docNumber: null, date: "2026-11-03", amount: 5, reason: "accrual", unrecorded: false, memo: null, editedAt: null },
    ],
  };
  const m = buildCreditsAdjustmentsModel(d, { ...info, periodLine: "p", from: "a", to: "b", formatDate: (s) => `F(${s})` });
  it("carries the tiles, reason tables and flags", () => {
    const fig = m.sections[0].rows;
    expect(fig[0].cells.slice(1, 4)).toEqual([300, 3, 6]);
    expect(fig[0].flags?.[3]).toBe(true); // > 5% of sales
    expect(fig[3].flags?.[4]).toBe(true); // lag > 7 days
    expect(fig[4].flags?.[2]).toBe(false);
    const cust = m.sections[1].rows;
    expect(cust.map((r) => r.cells[1])).toEqual([200, 100]);
    expect(cust[1].flags?.[0]).toBe(true);
  });
  it("lists documents with blanks as null and the screen's timestamp formatter", () => {
    const docs = m.sections[m.sections.length - 1].rows;
    expect(docs[0].cells).toEqual(["CN-1", "Credit note", "2026-11-01", 100, null, "m", "F(2026-11-02T10:00:00Z)"]);
    expect(docs[0].flags?.[4]).toBe(true);
    expect(docs[1].cells[0]).toBeNull();
    expect(m.sections[4].rows.some((r) => r.flags?.[1])).toBe(true);
    expect(m.notes.join(" ")).toMatch(/Supplier credits by reason: none/);
    expect(parseReportModel(m).ok).toBe(true);
  });
  it("exports the empty state with its note", () => {
    const e = buildCreditsAdjustmentsModel({ empty: true } as any, { ...info, periodLine: "p", from: "a", to: "b", formatDate: (s) => s });
    expect(e.notes).toEqual(["No native credits, journals or bills in this period."]);
    expect(parseReportModel(e).ok).toBe(true);
  });
});

describe("Item Ledger export", () => {
  const items = [{ id: "i1", name: "Salt", uom: "kg" }, { id: "i2", name: "Flour", uom: null }];
  const mv = (o: any) => ({ id: o.id, itemId: o.itemId, date: o.date, createdAt: o.date, movementType: o.type ?? "receipt", qty: o.qty, unitCost: o.unitCost ?? null, totalCost: o.total, lotNo: o.lot ?? null, docNo: o.docNo ?? null, docType: null, entryId: o.entryId ?? null });
  const ledgers = buildItemLedgers(items, new Map([["i1", { qty: 10, value: 20 }]]), [
    mv({ id: "m1", itemId: "i1", date: "2026-11-01", qty: 5, unitCost: 2, total: 10, lot: "L1", docNo: "GRN-1", entryId: "e1" }),
    mv({ id: "m2", itemId: "i1", date: "2026-11-02", type: "issue_sale", qty: -3, unitCost: 2, total: -6 }),
    mv({ id: "m3", itemId: "i2", date: "2026-11-02", qty: 4, total: 0, docNo: "GRN-2" }),
  ]);
  const d = { from: "2026-11-01", to: "2026-11-30", ledgers, truncated: false, itemOptions: items, tie: { stockValue: 24, glBalance: 24, difference: 0 } };
  const m = buildItemLedgerModel(d, { ...info, periodLine: "p", from: "2026-11-01", to: "2026-11-30", itemName: null });
  it("one block per item with opening, movements and closing that tie to the ledgers", () => {
    const rows = m.sections[0].rows;
    const salt = ledgers.find((l) => l.item.id === "i1")!;
    expect(rows[0].kind).toBe("heading");
    expect(rows.find((r) => r.cells[2] === "Opening balance" && r.cells[0] === "Salt")!.cells.slice(9)).toEqual([10, 20]);
    const closing = rows.find((r) => r.kind === "total" && r.cells[0] === "Salt")!;
    expect(closing.cells.slice(9)).toEqual([salt.closingQty, salt.closingValue]);
    // a movement with value but no ledger entry reads amber / "No ledger entry"
    const sale = rows.find((r) => r.kind === "line" && r.cells[2] === "Sale")!;
    expect(sale.cells[3]).toBe("No ledger entry");
    expect(sale.flags?.[3]).toBe(true);
    // a zero-value receipt shows its own number, unflagged
    const free = rows.find((r) => r.cells[3] === "GRN-2")!;
    expect(free.flags?.[3]).toBe(false);
    expect(parseReportModel(m).ok).toBe(true);
  });
  it("adds the total of closing values for several items and says when it ties", () => {
    expect(m.sections.some((s) => s.rows.some((r) => r.cells[0] === "Closing value of the items shown"))).toBe(true);
    expect(m.notes).toEqual([]);
  });
  it("carries the truncation notice and omits the combined total", () => {
    const t = buildItemLedgerModel({ ...d, truncated: true }, { ...info, periodLine: "p", from: "a", to: "b", itemName: "Salt" });
    expect(t.notes.join(" ")).toMatch(/more movements than can be shown/);
    expect(t.sections.some((s) => s.rows.some((r) => r.cells[0] === "Closing value of the items shown"))).toBe(false);
    expect(t.params[0]).toEqual({ label: "Item", value: "Salt" });
  });
  it("handles no movements and an out-of-tie difference", () => {
    const e = buildItemLedgerModel({ ...d, ledgers: [], tie: { stockValue: 5, glBalance: 1, difference: 4 } }, { ...info, periodLine: "p", from: "a", to: "b", itemName: null });
    expect(e.notes.join(" ")).toMatch(/No stock movements/);
    expect(e.notes.join(" ")).toMatch(/does not tie/);
    expect(e.sections[1].rows[2].flags).toEqual([true, true]);
  });
});

describe("components wire the export model", () => {
  it("each Phase 2 finance component passes exportModel", () => {
    expect(read("components/finance-reports.tsx")).toMatch(/icon=\{Receipt\} onRefresh=\{load\} loading=\{data === null\} exportModel=\{exportModel\}/);
    for (const rel of ["components/fx-report.tsx", "components/stock-vs-gl-report.tsx", "components/credits-adjustments-report.tsx", "components/item-ledger-report.tsx"]) {
      expect(read(rel), rel).toMatch(/exportModel=\{exportModel\}/);
      expect(read(rel), rel).toMatch(/loadedKey/);
    }
  });
  it("builders never read the clock or build dates", () => {
    const dir = join(root, "lib/reports/builders");
    for (const f of ["tax-liability.ts", "fx-exposure.ts", "stock-vs-gl.ts", "credits-adjustments.ts", "item-ledger.ts"]) {
      const src = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/new Date\(|Date\.now\(|toISOString|toLocaleDateString|toFixed\(/);
    }
  });
});

