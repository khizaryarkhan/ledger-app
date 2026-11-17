import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildItemLedgers, totalClosingValue, type LedgerItem, type LedgerMovement } from "@/lib/inventory/item-ledger";

const chicken: LedgerItem = { id: "c", name: "Chicken", uom: "oz" };
const salt: LedgerItem = { id: "s", name: "Salt", uom: "g" };

let n = 0;
const mv = (over: Partial<LedgerMovement>): LedgerMovement => ({
  id: `m${++n}`, itemId: "c", date: "2026-11-11", createdAt: `2026-11-11T10:00:0${n % 10}Z`, movementType: "receipt",
  qty: 100, unitCost: 0.5, totalCost: 50, lotNo: "LOT-1", docNo: "GRN-0004", docType: "GoodsReceipt", entryId: "e1", ...over,
});

describe("item ledger", () => {
  it("runs quantity and value down the page from the opening balance", () => {
    const [l] = buildItemLedgers([chicken], new Map([["c", { qty: 10, value: 5 }]]), [
      mv({ qty: 100, totalCost: 50 }),
      mv({ movementType: "issue_production", qty: -40, totalCost: -20, date: "2026-11-16", docNo: "BUILD-0002", docType: "Production" }),
    ]);
    expect(l.openingQty).toBe(10);
    expect(l.lines.map(x => x.balanceQty)).toEqual([110, 70]);
    expect(l.lines.map(x => x.balanceValue)).toEqual([55, 35]);
    expect(l.inQty).toBe(100); expect(l.outQty).toBe(40); expect(l.inValue).toBe(50); expect(l.outValue).toBe(20);
    expect(l.closingQty).toBe(70); expect(l.closingValue).toBe(35);
  });

  it("keeps each item in its own ledger, ordered by name, and drops items with nothing to show", () => {
    const ls = buildItemLedgers([salt, chicken, { id: "x", name: "Idle", uom: "kg" }], new Map(), [
      mv({ itemId: "s", qty: 250, totalCost: 500, unitCost: 2 }), mv({ itemId: "c" }),
    ]);
    expect(ls.map(l => l.item.name)).toEqual(["Chicken", "Salt"]);
  });

  it("keeps an item that held stock before the period even with no movement in it", () => {
    const ls = buildItemLedgers([chicken], new Map([["c", { qty: 5, value: 2.5 }]]), []);
    expect(ls).toHaveLength(1);
    expect(ls[0].closingQty).toBe(5);
  });

  it("leaves transfers out — they change where stock is, never how much or what it cost", () => {
    const [l] = buildItemLedgers([chicken], new Map(), [mv({}), mv({ movementType: "transfer", qty: -100, totalCost: -50 })]);
    expect(l.lines).toHaveLength(1);
    expect(l.closingQty).toBe(100);
  });

  it("orders same-day movements by when they were recorded", () => {
    const [l] = buildItemLedgers([chicken], new Map(), [
      mv({ id: "late", createdAt: "2026-11-11T12:00:00Z", qty: -10, totalCost: -5, movementType: "issue_sale" }),
      mv({ id: "early", createdAt: "2026-11-11T09:00:00Z" }),
    ]);
    expect(l.lines.map(x => x.id)).toEqual(["early", "late"]);
  });

  it("counts value that moved with no ledger entry behind it (the books do not know about it)", () => {
    const [l] = buildItemLedgers([salt], new Map(), [mv({ itemId: "s", qty: 500, unitCost: 2, totalCost: 1000, entryId: null, docNo: null, docType: null })]);
    expect(l.unposted).toBe(1);
  });

  it("does not call a zero-value receipt missing — there is nothing to post", () => {
    const [l] = buildItemLedgers([salt], new Map(), [mv({ itemId: "s", qty: 5000, unitCost: 0, totalCost: 0, entryId: null, docNo: "GRN-0006", docType: null })]);
    expect(l.unposted).toBe(0);
  });

  it("does not drift on repeating decimals", () => {
    const [l] = buildItemLedgers([chicken], new Map(), [mv({ qty: 0.1, totalCost: 0.1 }), mv({ qty: 0.2, totalCost: 0.2 })]);
    expect(l.closingQty).toBe(0.3);
    expect(l.closingValue).toBe(0.3);
  });

  it("totals the closing value across the items shown", () => {
    const ls = buildItemLedgers([chicken, salt], new Map(), [mv({}), mv({ itemId: "s", qty: 250, totalCost: 500 })]);
    expect(totalClosingValue(ls)).toBe(550);
  });
});

describe("the loader keeps the same inclusion rule as Stock vs GL", () => {
  it("excludes transfers and falls back to the recorded day when a movement has no date", () => {
    const src = readFileSync("lib/inventory/item-ledger-server.ts", "utf8");
    expect(src).toContain("movement_type <> 'transfer'");
    expect(src).toContain("coalesce(m.movement_date, m.created_at::date)");
  });
});
