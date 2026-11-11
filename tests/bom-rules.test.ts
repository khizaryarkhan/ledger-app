import { describe, it, expect } from "vitest";
import {
  findDuplicates, validateBom, parseEntry, quantityCheck, weightBalance, costRollup,
  suggestPackQty, nextCopyCode, type BomInput,
} from "@/lib/inventory/bom-rules";

const base = (over: Partial<BomInput> = {}): BomInput => ({
  code: "BOM_X", name: "Bar", outputItemId: "fp1", outputSkuId: null, status: "Active", batchType: "Output",
  batchSize: 1000, expYield: 98, processingStep: null, notes: null,
  outputs: [{ skuId: "sA", qty: 1 }],
  inputs: [{ itemId: "i1", qty: 18, uom: "kg" }],
  packs: [], ops: [], ...over,
});

describe("findDuplicates", () => {
  it("flags the same output SKU twice", () => {
    const d = findDuplicates(base({ outputs: [{ skuId: "sA", qty: 1 }, { skuId: "sA", qty: 12 }] }));
    expect(d).toEqual([{ kind: "output", key: "sA" }]);
  });
  it("treats two base-unit outputs (null sku) as the same output", () => {
    const d = findDuplicates(base({ outputs: [{ skuId: null, qty: 1 }, { skuId: null, qty: 1 }] }));
    expect(d.map(x => x.kind)).toEqual(["output"]);
  });
  it("flags the same ingredient twice", () => {
    const d = findDuplicates(base({ inputs: [{ itemId: "i1", qty: 1, uom: "kg" }, { itemId: "i1", qty: 2, uom: "kg" }] }));
    expect(d).toEqual([{ kind: "input", key: "i1" }]);
  });
  it("flags the same packaging item on the same pack, but not on different packs", () => {
    const dup = findDuplicates(base({ packs: [{ itemId: "p1", qty: 1, uom: "each", forSkuId: "sA" }, { itemId: "p1", qty: 1, uom: "each", forSkuId: "sA" }] }));
    expect(dup).toEqual([{ kind: "pack", key: "p1|sA" }]);
    const ok = findDuplicates(base({ outputs: [{ skuId: "sA", qty: 1 }, { skuId: "sB", qty: 12 }], packs: [{ itemId: "p1", qty: 1, uom: "each", forSkuId: "sA" }, { itemId: "p1", qty: 1, uom: "each", forSkuId: "sB" }] }));
    expect(ok).toEqual([]);
  });
  it("reports nothing for a clean recipe", () => expect(findDuplicates(base())).toEqual([]));
});

describe("validateBom", () => {
  it("accepts a clean recipe", () => expect(validateBom(base())).toEqual([]));
  it("requires a name, a batch above zero and an ingredient", () => {
    const e = validateBom(base({ name: " ", batchSize: 0, inputs: [] }));
    expect(e.join("|")).toMatch(/name/i);
    expect(e.join("|")).toMatch(/batch/i);
    expect(e.join("|")).toMatch(/ingredient/i);
  });
  it("refuses a zero or negative ingredient amount", () => {
    expect(validateBom(base({ inputs: [{ itemId: "i1", qty: 0, uom: "kg" }] })).join()).toMatch(/amount/i);
    expect(validateBom(base({ inputs: [{ itemId: "i1", qty: -1, uom: "kg" }] })).join()).toMatch(/amount/i);
  });
  it("refuses a pack pointing at an output that is not in the BOM", () => {
    expect(validateBom(base({ packs: [{ itemId: "p1", qty: 1, uom: "each", forSkuId: "zzz" }] })).join()).toMatch(/pack/i);
  });
  it("lets packaging attach to the base unit when the recipe has no output packs", () => {
    expect(validateBom(base({ outputs: [], packs: [{ itemId: "p1", qty: 1, uom: "each", forSkuId: null }] }))).toEqual([]);
    expect(validateBom(base({ outputs: [], packs: [{ itemId: "p1", qty: 1, uom: "each", forSkuId: "sA" }] })).join()).toMatch(/pack/i);
  });
  it("names duplicates in the message", () => {
    expect(validateBom(base({ outputs: [{ skuId: "sA", qty: 1 }, { skuId: "sA", qty: 1 }] })).join()).toMatch(/more than once/i);
  });
  it("refuses an output with no content per pack", () => {
    expect(validateBom(base({ outputs: [{ skuId: "sA", qty: 0 }] })).join()).toMatch(/content/i);
  });
  it("refuses a yield outside 0-100", () => {
    expect(validateBom(base({ expYield: 120 })).join()).toMatch(/yield/i);
  });
  it("refuses operations with no hours", () => {
    expect(validateBom(base({ ops: [{ workCentreId: "w1", hoursPerBatch: 0, description: null }] })).join()).toMatch(/hours/i);
  });
});

describe("parseEntry", () => {
  it("splits name, amount and unit", () => expect(parseEntry("honey 7 kg")).toEqual({ query: "honey", qty: 7, unit: "kg" }));
  it("accepts a comma decimal and glued unit", () => expect(parseEntry("salt 0,2kg")).toEqual({ query: "salt", qty: 0.2, unit: "kg" }));
  it("returns only a query when there is no amount", () => expect(parseEntry("rolled oats")).toEqual({ query: "rolled oats", qty: null, unit: "" }));
  it("keeps digits that belong to the name", () => expect(parseEntry("oil 20L can").qty).toBeNull());
});

describe("quantityCheck", () => {
  it("flags an amount ten times the reference, scaled to batch", () => {
    const r = quantityCheck({ qty: 180, referenceQty: 18, referenceBatch: 1000, batch: 1000 });
    expect(r).toEqual({ flagged: true, expected: 18 });
  });
  it("scales the reference to a different batch", () => {
    expect(quantityCheck({ qty: 180, referenceQty: 18, referenceBatch: 1000, batch: 2000 }).flagged).toBe(true);
    expect(quantityCheck({ qty: 36, referenceQty: 18, referenceBatch: 1000, batch: 2000 }).flagged).toBe(false);
    expect(quantityCheck({ qty: 36, referenceQty: 18, referenceBatch: 1000, batch: 2000 }).expected).toBe(36);
  });
  it("does not flag within 4x either way", () => {
    expect(quantityCheck({ qty: 30, referenceQty: 18, referenceBatch: 1000, batch: 1000 }).flagged).toBe(false);
    expect(quantityCheck({ qty: 6, referenceQty: 18, referenceBatch: 1000, batch: 1000 }).flagged).toBe(false);
  });
  it("never flags without a usable reference", () => {
    expect(quantityCheck({ qty: 5, referenceQty: 0, referenceBatch: 1000, batch: 1000 }).flagged).toBe(false);
    expect(quantityCheck({ qty: 5, referenceQty: 18, referenceBatch: 0, batch: 1000 }).flagged).toBe(false);
  });
});

describe("weightBalance", () => {
  const w = (kgPerUnit: number | null, qty = 1) => ({ itemId: "x", name: "X", qty, kgPerUnit });
  it("is idle with nothing to compare", () => expect(weightBalance({ inputs: [], outKg: 0, expYield: 98 }).state).toBe("idle"));
  it("is ok inside the expected loss", () => {
    const r = weightBalance({ inputs: [w(1, 40)], outKg: 39.2, expYield: 98 });
    expect(r.state).toBe("ok");
    expect(r.keptPct).toBe(98);
  });
  it("warns when more comes out than goes in", () => expect(weightBalance({ inputs: [w(1, 40)], outKg: 45, expYield: 98 }).state).toBe("gain"));
  it("warns when much more is lost than expected", () => expect(weightBalance({ inputs: [w(1, 40)], outKg: 30, expYield: 98 }).state).toBe("loss"));
  it("is incomplete, naming the item, when an ingredient has no weight", () => {
    const r = weightBalance({ inputs: [w(1, 40), { itemId: "oil", name: "Oil", qty: 3, kgPerUnit: null }], outKg: 40, expYield: 98 });
    expect(r.state).toBe("incomplete");
    expect(r.missing).toEqual(["Oil"]);
  });
  it("treats a missing expected yield as 100%", () => expect(weightBalance({ inputs: [w(1, 40)], outKg: 35, expYield: null }).state).toBe("loss"));
});

describe("costRollup", () => {
  it("adds materials, packaging, labour and overhead and divides by the batch", () => {
    const r = costRollup({
      batch: 1000,
      lines: [{ qty: 18, unitCost: 1.9, isPack: false }, { qty: 1000, unitCost: 0.02, isPack: true }],
      ops: [{ hours: 2, labourRate: 18, overheadRate: 6 }],
    });
    expect(r.materials).toBeCloseTo(34.2, 6);
    expect(r.packaging).toBeCloseTo(20, 6);
    expect(r.labour).toBe(36);
    expect(r.overhead).toBe(12);
    expect(r.total).toBeCloseTo(102.2, 6);
    expect(r.perUnit).toBeCloseTo(0.1022, 6);
  });
  it("gives zero per unit for a zero batch and counts unknown costs", () => {
    const r = costRollup({ batch: 0, lines: [{ qty: 1, unitCost: null, isPack: false }], ops: [] });
    expect(r.perUnit).toBe(0);
    expect(r.unpriced).toBe(1);
  });
});

describe("suggestPackQty", () => {
  it("rounds packs up from the batch", () => expect(suggestPackQty({ batchBase: 1000, contentPerPack: 12, perPack: 1 })).toBe(84));
  it("scales by the amount per pack", () => expect(suggestPackQty({ batchBase: 1000, contentPerPack: 1, perPack: 2 })).toBe(2000));
  it("returns null when it cannot be worked out", () => expect(suggestPackQty({ batchBase: 1000, contentPerPack: 0, perPack: 1 })).toBeNull());
});

describe("nextCopyCode", () => {
  it("adds -V2 first", () => expect(nextCopyCode("BOM_HOB-40", ["BOM_HOB-40"])).toBe("BOM_HOB-40-V2"));
  it("steps past versions already taken", () => expect(nextCopyCode("BOM_HOB-40", ["BOM_HOB-40", "BOM_HOB-40-V2"])).toBe("BOM_HOB-40-V3"));
  it("continues from a source that is itself a version", () => expect(nextCopyCode("BOM_HOB-40-V2", ["BOM_HOB-40-V2"])).toBe("BOM_HOB-40-V3"));
  it("is case-insensitive about what is taken", () => expect(nextCopyCode("a", ["A", "a-v2"])).toBe("a-V3"));
});
