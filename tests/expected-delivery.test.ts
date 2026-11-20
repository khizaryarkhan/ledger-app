import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { prepareDelivery, deliveryState, matchSsccs, prefillFromDelivery, type PreparedDelivery } from "@/lib/inventory/expected-delivery";
import { buildSscc } from "@/lib/inventory/sscc";

const S1 = buildSscc(0, "0614141", 1);
const S2 = buildSscc(0, "0614141", 2);
const S3 = buildSscc(0, "0614141", 3);
const poLines = [{ id: "PL1", itemId: "RICE" }, { id: "PL2", itemId: "OIL" }];
const value = (r: ReturnType<typeof prepareDelivery>) => (r as { ok: true; value: PreparedDelivery }).value;

describe("prepareDelivery", () => {
  it("takes each line's item from the PO line it names", () => {
    const r = prepareDelivery({ reference: " ASN 1 ", lines: [{ poLineId: "PL1", qtyBase: "10" }] }, { poLines });
    expect(r.ok).toBe(true);
    expect(value(r).lines[0]).toMatchObject({ poLineId: "PL1", itemId: "RICE", qtyBase: 10, lineNo: 1 });
    expect(value(r).reference).toBe("ASN 1");
    expect(value(r).source).toBe("manual");
  });

  it("refuses a line of another order and an item that is not the PO line's", () => {
    expect(prepareDelivery({ lines: [{ poLineId: "X", qtyBase: 1 }] }, { poLines })).toEqual({ ok: false, error: expect.stringMatching(/choose a line of the purchase order/) });
    expect(prepareDelivery({ lines: [{ poLineId: "PL1", itemId: "OIL", qtyBase: 1 }] }, { poLines })).toEqual({ ok: false, error: expect.stringMatching(/not the one on that purchase order line/) });
  });

  it("without a PO, needs a known item and refuses a PO line", () => {
    expect(prepareDelivery({ lines: [{ itemId: "RICE", qtyBase: 1 }] }, { poLines: null, knownItemIds: new Set(["RICE"]) }).ok).toBe(true);
    expect(prepareDelivery({ lines: [{ itemId: "NOPE", qtyBase: 1 }] }, { poLines: null, knownItemIds: new Set(["RICE"]) })).toEqual({ ok: false, error: expect.stringMatching(/item not found/) });
    expect(prepareDelivery({ lines: [{ poLineId: "PL1", itemId: "RICE", qtyBase: 1 }] }, { poLines: null })).toEqual({ ok: false, error: expect.stringMatching(/names no purchase order/) });
  });

  it("refuses no lines, a zero quantity, and dates out of order", () => {
    expect(prepareDelivery({ lines: [] }, { poLines })).toEqual({ ok: false, error: expect.stringMatching(/at least one line/) });
    expect(prepareDelivery({ lines: [{ poLineId: "PL1", qtyBase: 0 }] }, { poLines })).toEqual({ ok: false, error: expect.stringMatching(/more than zero/) });
    expect(prepareDelivery({ shipDate: "2026-11-20", expectedDate: "2026-11-19", lines: [{ poLineId: "PL1", qtyBase: 1 }] }, { poLines })).toEqual({ ok: false, error: expect.stringMatching(/before the ship date/) });
    expect(prepareDelivery({ shipDate: "2026-02-30", lines: [{ poLineId: "PL1", qtyBase: 1 }] }, { poLines })).toEqual({ ok: false, error: expect.stringMatching(/not a real date/) });
    expect(prepareDelivery({ lines: [{ poLineId: "PL1", qtyBase: 1, productionDate: "2026-11-10", expiryDate: "2026-11-01" }] }, { poLines })).toEqual({ ok: false, error: expect.stringMatching(/expiry is before the production date/) });
  });

  it("adds a line's SSCC as a package when the package list leaves it out", () => {
    const r = prepareDelivery({ lines: [{ poLineId: "PL1", qtyBase: 5, sscc: `(00)${S1}` }] }, { poLines });
    expect(value(r).packages).toEqual([{ sscc: S1, packType: null, parentSscc: null }]);
    expect(value(r).lines[0].sscc).toBe(S1);
  });

  it("refuses a misread SSCC, one listed twice, an unlisted pallet and a second level of nesting", () => {
    const bad = S1.slice(0, 17) + ((Number(S1[17]) + 1) % 10);
    expect(prepareDelivery({ lines: [{ poLineId: "PL1", qtyBase: 1, sscc: bad }] }, { poLines })).toEqual({ ok: false, error: expect.stringMatching(/Check digit/) });
    expect(prepareDelivery({ packages: [{ sscc: S1 }, { sscc: S1 }], lines: [{ poLineId: "PL1", qtyBase: 1 }] }, { poLines })).toEqual({ ok: false, error: expect.stringMatching(/listed twice/) });
    expect(prepareDelivery({ packages: [{ sscc: S2, parentSscc: S1 }], lines: [{ poLineId: "PL1", qtyBase: 1 }] }, { poLines })).toEqual({ ok: false, error: expect.stringMatching(/does not list/) });
    expect(prepareDelivery({ packages: [{ sscc: S1 }, { sscc: S2, parentSscc: S1 }, { sscc: S3, parentSscc: S2 }], lines: [{ poLineId: "PL1", qtyBase: 1 }] }, { poLines }))
      .toEqual({ ok: false, error: expect.stringMatching(/one level only/) });
  });
});

describe("deliveryState", () => {
  it("is received only while linked to a receipt, so voiding the receipt reopens it", () => {
    expect(deliveryState({ status: "open", goodsReceiptId: null })).toBe("expected");
    expect(deliveryState({ status: "open", goodsReceiptId: "GR1" })).toBe("received");
    expect(deliveryState({ status: "cancelled", goodsReceiptId: null })).toBe("cancelled");
  });
});

describe("matchSsccs", () => {
  it("names what was announced but not scanned, and what was scanned but not announced", () => {
    expect(matchSsccs([S1, S2], [S2, S3])).toEqual({ matched: [S2], missing: [S1], unexpected: [S3] });
  });
});

describe("prefillFromDelivery", () => {
  const open = [
    { lineId: "PL1", itemId: "RICE", itemName: "Rice", baseUom: "kg", unitCostBase: 2, remainingQty: 100 },
    { lineId: "PL2", itemId: "OIL", itemName: "Oil", baseUom: "l", unitCostBase: 3, remainingQty: 5 },
  ];
  const line = (poLineId: string | null, qtyBase: number, batch: string | null = null) =>
    ({ poLineId, qtyBase, supplierBatchNo: batch, productionDate: null, bestBeforeDate: null, expiryDate: null });

  it("groups batches of one PO line into one draft with a receipt line per batch, and never sends a lot number", () => {
    const { drafts, skipped, over } = prefillFromDelivery([line("PL1", 40, "B1"), line("PL1", 60, "B2")], "PO1", open);
    expect(skipped).toBe(0);
    expect(over).toEqual([]);
    expect(drafts.PL1.qty).toBe(100);
    expect(drafts.PL1.lines).toHaveLength(2);
    expect(drafts.PL1.lines[0]).toMatchObject({ poId: "PO1", poLineId: "PL1", itemId: "RICE", qtyBase: 40, unitCost: 2, lotNo: null, supplierBatchNo: "B1" });
  });

  it("leaves out a line the order no longer expects and names one announcing more than still expected", () => {
    const { drafts, skipped, over } = prefillFromDelivery([line("GONE", 1), line(null, 1), line("PL2", 7)], "PO1", open);
    expect(skipped).toBe(2);
    expect(Object.keys(drafts)).toEqual(["PL2"]);
    expect(over).toEqual(["Oil"]);
  });
});

describe("migration 0144 and the receiving route", () => {
  const sql = readFileSync("db/migrations/0144_expected_deliveries.sql", "utf8");
  it("derives 'received' from the receipt link, which voiding the receipt clears", () => {
    expect(sql).toMatch(/"goods_receipt_id" uuid REFERENCES "goods_receipts"\("id"\) ON DELETE set null/);
    expect(sql).toMatch(/UNIQUE INDEX[^;]+expected_deliveries_ref_uq[^;]+upper\("reference"\)\) WHERE "reference" IS NOT NULL AND "status" <> 'cancelled'/);
  });
  it("checks the delivery BEFORE the receipt posts, and links it only after", () => {
    const route = readFileSync("app/api/inventory/receiving/route.ts", "utf8");
    const check = route.indexOf("checkDeliveryForReceipt(");
    const post = route.indexOf("postGoodsReceipt(orgId!");
    const attach = route.indexOf("attachReceipt(");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(post);
    expect(attach).toBeGreaterThan(post);
  });
});
