import { describe, it, expect } from "vitest";
import { syncPackTags } from "@/components/bom-builder/draft";

const out = (...ids: string[]) => ids.map((skuId, i) => ({ key: `o${i}`, skuId, qty: "" }));
const pack = (itemId: string, forSkuId: string | null) => ({ key: itemId, itemId, qty: "1", forSkuId, subs: [] } as any);

describe("packaging tags follow the output SKUs", () => {
  it("never re-tags a line whose SKU was removed onto the survivor", () => {
    const r = syncPackTags([pack("PA", "A"), pack("PB", "B")], out("A"));
    expect(r.find(p => p.itemId === "PA")!.forSkuId).toBe("A");
    expect(r.find(p => p.itemId === "PB")!.forSkuId).toBeNull();   // stays untagged: Save is blocked until chosen
  });
  it("tags a line that was never tagged when exactly one SKU exists", () => {
    expect(syncPackTags([pack("PA", null)], out("A"))[0].forSkuId).toBe("A");
  });
  it("leaves an untagged line alone when there are several SKUs", () => {
    expect(syncPackTags([pack("PA", null)], out("A", "B"))[0].forSkuId).toBeNull();
  });
});
