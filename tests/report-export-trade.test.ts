import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildOpenPosModel, buildExpectedBillsModel, buildOpenBillsModel } from "@/lib/reports/builders/procurement";
import { buildOpenSosModel, buildAwaitingInvoicingModel, buildOpenInvoicesModel } from "@/lib/reports/builders/sales";
import { tradeDataUnusable } from "@/lib/reports/builders/trade-shared";

const info = { entity: "Acme Ltd", currency: "EUR" };
const lines = (m: any) => m.sections[0].rows.filter((r: any) => r.kind === "line");
const total = (m: any) => m.sections[0].rows.find((r: any) => r.kind === "total");

const po = { rows: [
  { id: "aaaaaaaa-1", docNumber: "PO-1", supplier: "Sup A", date: "2026-10-01", status: "Partial", remainingValue: "40.5" },
  { id: "bbbbbbbb-2", docNumber: "", supplier: "", date: "2026-10-02", status: "Open", remainingValue: 10 },
], total: 50.5 };
const eb = { rows: [{ id: "c1", receiptNo: "GRN-1", supplierLabel: "Sup A", receiptDate: "2026-10-03", received: 100, billed: 40, openAmount: 60 }], total: 60 };
const ob = { rows: [
  { id: "d1", docNumber: "B-1", supplier: "Sup A", dueDate: "2026-09-01", total: 100, open: 100, overdue: true },
  { id: "d2", docNumber: "B-2", supplier: "Sup B", dueDate: "2026-12-01T00:00:00.000Z", total: 50, open: 25, overdue: false },
], total: 125 };
const so = { rows: [{ id: "e1", docNumber: "SO-1", customer: "Cust", date: "2026-10-05", status: "Partial", remainingValue: 7 }], total: 7 };
const ai = { rows: [{ id: "f1", shipmentNo: "SH-1", customerLabel: "Cust", shipmentDate: "2026-10-06", saleValue: 90, invoiced: 30, openAmount: 60 }], total: 60 };
const oi = { rows: [{ id: "g1", docNumber: "INV-1", customer: "Cust", dueDate: "2026-10-30", total: 10, open: 10, overdue: true }], total: 10 };

describe("trade report exports", () => {
  it("Open POs: totals tie, blank number falls back, partial is flagged", () => {
    const m = buildOpenPosModel(po, po.rows, info);
    expect(lines(m)).toHaveLength(2);
    expect(total(m).cells[4]).toBe(50.5);
    expect(total(m).cells[0]).toBe("Total remaining on order");
    expect(lines(m)[1].cells[0]).toBe("bbbbbbbb");
    expect(lines(m)[1].cells[1]).toBe("—");
    expect(lines(m)[0].flags?.[3]).toBe(true);
    expect(lines(m)[1].flags).toBeUndefined();
    expect(lines(m)[0].cells[4]).toBe(40.5);
    expect(m.notes).toEqual([]);
  });
  it("Expected Bills ties", () => {
    const m = buildExpectedBillsModel(eb, eb.rows, info);
    expect(lines(m)[0].cells).toEqual(["GRN-1", "Sup A", "2026-10-03", 100, 40, 60]);
    expect(total(m).cells[5]).toBe(60);
  });
  it("Open Bills: overdue flagged, midnight timestamp keeps its date, filtered note", () => {
    const m = buildOpenBillsModel(ob, [ob.rows[1]], info);
    expect(lines(m)[0].cells[2]).toBe("2026-12-01");
    expect(m.notes[0]).toMatch(/1 of 2 bills/);
    expect(total(m).cells[4]).toBe(125);
    const full = buildOpenBillsModel(ob, ob.rows, info);
    expect(lines(full)[0].flags?.[2]).toBe(true);
    expect(lines(full)[1].flags).toBeUndefined();
  });
  it("sales builders mirror their screens", () => {
    expect(total(buildOpenSosModel(so, so.rows, info)).cells[4]).toBe(7);
    expect(lines(buildOpenSosModel(so, so.rows, info))[0].flags?.[3]).toBe(true);
    const a = buildAwaitingInvoicingModel(ai, ai.rows, info);
    expect(lines(a)[0].cells).toEqual(["SH-1", "Cust", "2026-10-06", 90, 30, 60]);
    expect(total(a).cells[5]).toBe(60);
    const i = buildOpenInvoicesModel(oi, oi.rows, info);
    expect(i.title).toBe("Open Invoices");
    expect(lines(i)[0].flags?.[2]).toBe(true);
  });
  it("empty state has no total row", () => {
    const e = { rows: [], total: 0 };
    for (const m of [buildOpenPosModel(e, [], info), buildOpenBillsModel(e, [], info), buildOpenInvoicesModel(e, [], info)]) {
      expect(m.sections[0].rows).toEqual([]);
    }
  });
  it("holds back loading, failed and error responses", () => {
    expect(tradeDataUnusable(null)).toBe(true);
    expect(tradeDataUnusable({ failed: true, rows: [], total: 0 })).toBe(true);
    expect(tradeDataUnusable({ error: "x", rows: [] })).toBe(true);
    expect(tradeDataUnusable({ rows: [] })).toBe(false);
  });
  it("does not mutate its input", () => {
    const copy = JSON.stringify(ob);
    buildOpenBillsModel(ob, ob.rows, info);
    expect(JSON.stringify(ob)).toBe(copy);
  });
  it("components pass exportModel and clear before refetch", () => {
    for (const f of ["components/procurement-reports.tsx", "components/sales-reports.tsx"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect((src.match(/exportModel=\{exportModel\}/g) ?? []).length).toBe(3);
      expect(src).toMatch(/setData\(null\)/);
      expect(src).toMatch(/failed: true/);
    }
  });
});
