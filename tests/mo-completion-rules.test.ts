import { describe, it, expect } from "vitest";
import { defaultConsumeQty, skuRunFractions, dateBeforeLotError, expiredWithoutReasonError, expiredLotAudit, statusAfterVoid } from "@/lib/inventory/mo-rules";

describe("default consumption of a partial run", () => {
  const outputs = [{ skuId: "A", remaining: 100 }, { skuId: "B", remaining: 100 }];
  const frac = skuRunFractions(outputs, [{ skuId: "A", goodPacks: 50 }]);
  // The OLD behaviour: every allocation scaled by the base share (25% of 200 packs here).
  const share = 0.25;

  it("does not use packaging of a SKU the run did not make", () => {
    const boxB = defaultConsumeQty({ allocQty: 100, rows: [{ kind: "packaging", forSkuId: "B", plannedQty: 100 }], share, final: false, skuFraction: frac });
    expect(boxB).toBe(0);
    expect(boxB).not.toBe(100 * share); // old behaviour would give 25
  });
  it("scales packaging by its own SKU fraction", () => {
    expect(defaultConsumeQty({ allocQty: 100, rows: [{ kind: "packaging", forSkuId: "A", plannedQty: 100 }], share, final: false, skuFraction: frac })).toBe(50);
  });
  it("keeps ingredients on the base share", () => {
    expect(defaultConsumeQty({ allocQty: 80, rows: [{ kind: "ingredient", forSkuId: null, plannedQty: 80 }], share, final: false, skuFraction: frac })).toBe(20);
  });
  it("weights an item that is both", () => {
    expect(defaultConsumeQty({ allocQty: 100, rows: [{ kind: "ingredient", forSkuId: null, plannedQty: 50 }, { kind: "packaging", forSkuId: "A", plannedQty: 50 }], share, final: false, skuFraction: frac })).toBe(37.5);
  });
  it("a final run uses everything", () => {
    expect(defaultConsumeQty({ allocQty: 100, rows: [{ kind: "packaging", forSkuId: "B", plannedQty: 100 }], share, final: true, skuFraction: frac })).toBe(100);
  });
  it("fraction is 0 for a pack with nothing remaining", () => {
    expect(skuRunFractions([{ skuId: "A", remaining: 0 }], [{ skuId: "A", goodPacks: 5 }]).get("A")).toBe(0);
  });
});

describe("date and expiry rules", () => {
  const lot = { lotId: "l1", lotNo: "LOT-1", receivedDate: "2026-11-10", expiryDate: "2026-11-12", reason: null };
  it("refuses a date before the lot was received, naming lot and date", () => {
    const m = dateBeforeLotError("2026-11-09", [lot]);
    expect(m).toContain("LOT-1");
    expect(m).toContain("2026-11-10");
  });
  it("allows the received day and future dates", () => {
    expect(dateBeforeLotError("2026-11-10", [lot])).toBeNull();
    expect(dateBeforeLotError("2030-01-01", [{ ...lot, expiryDate: null }])).toBeNull();
  });
  it("expired lot needs a reason", () => {
    expect(expiredWithoutReasonError("2026-11-13", [lot])).toContain("LOT-1");
    expect(expiredWithoutReasonError("2026-11-13", [{ ...lot, reason: "  " }])).not.toBeNull();
    expect(expiredWithoutReasonError("2026-11-13", [{ ...lot, reason: "approved by QA" }])).toBeNull();
  });
  it("expiry day itself is still usable", () => {
    expect(expiredWithoutReasonError("2026-11-12", [lot])).toBeNull();
  });
  it("audit meta lists only expired lots", () => {
    expect(expiredLotAudit("2026-11-12", [lot])).toBeNull();
    expect(expiredLotAudit("2026-11-13", [{ ...lot, reason: "ok" }])!.lots[0]).toEqual({ lotNo: "LOT-1", expiryDate: "2026-11-12", reason: "ok" });
  });
});

describe("void", () => {
  it("reopens only a completed order", () => {
    expect(statusAfterVoid("Completed")).toBe("InProgress");
    expect(statusAfterVoid("InProgress")).toBe("InProgress");
  });
});
