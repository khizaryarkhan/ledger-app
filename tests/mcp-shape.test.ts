import { describe, it, expect } from "vitest";
import { shapeJson, parseShapeArgs, describePage, DEFAULT_LIMIT } from "@/lib/mcp/shape";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, name: `R${i}`, total: i * 10, email: `x${i}@y.z` }));

describe("shapeJson", () => {
  it("leaves a short answer exactly as it was", () => {
    const v = { invoices: rows(3) };
    expect(shapeJson(v, {})).toEqual({ value: v, page: null });
  });
  it("pages a long list by default, and says how to get the rest", () => {
    const r = shapeJson(rows(250), {});
    expect((r.value as unknown[]).length).toBe(DEFAULT_LIMIT);
    expect(r.page).toEqual({ path: "$", total: 250, offset: 0, returned: 100, nextOffset: 100 });
    expect(describePage(r.page!)).toMatch(/rows 1–100 of 250.*offset 100/);
  });
  it("finds the rows under a key, and picks the biggest list rather than the first", () => {
    const v = { currencies: ["EUR", "GBP"], invoices: rows(150), asOf: "2026-11-03" };
    const r = shapeJson(v, { limit: 10, offset: 140 });
    const out = r.value as any;
    expect(out.currencies).toEqual(["EUR", "GBP"]);
    expect(out.asOf).toBe("2026-11-03");
    expect(out.invoices.map((x: any) => x.id)).toEqual([140, 141, 142, 143, 144, 145, 146, 147, 148, 149]);
    expect(r.page!.nextOffset).toBeNull();
  });
  it("finds rows two levels down", () => {
    const r = shapeJson({ data: { rows: rows(5) } }, { limit: 2 });
    expect((r.value as any).data.rows).toHaveLength(2);
    expect(r.page!.path).toBe("data.rows");
  });
  it("keeps only the requested fields", () => {
    const r = shapeJson(rows(3), { fields: ["id", "total", "missing"] });
    expect(r.value).toEqual([{ id: 0, total: 0 }, { id: 1, total: 10 }, { id: 2, total: 20 }]);
  });
  it("an offset past the end returns nothing, not an error", () => {
    const r = shapeJson(rows(3), { offset: 10 });
    expect(r.value).toEqual([]);
    expect(describePage(r.page!)).toMatch(/none at offset 3/);
  });
  it("does not touch a body with no list", () => {
    expect(shapeJson({ total: 5 }, { limit: 1 })).toEqual({ value: { total: 5 }, page: null });
    expect(shapeJson("text", {})).toEqual({ value: "text", page: null });
  });
  it("does not change the original object", () => {
    const v = { invoices: rows(200) };
    shapeJson(v, { limit: 5 });
    expect(v.invoices).toHaveLength(200);
  });
});

describe("parseShapeArgs", () => {
  it("accepts sensible values and comma or array fields", () => {
    expect(parseShapeArgs({ limit: 50, offset: 0, fields: "id, name" })).toEqual({ ok: true, opts: { limit: 50, offset: 0, fields: ["id", "name"] } });
    expect(parseShapeArgs({ fields: ["id"] })).toEqual({ ok: true, opts: { fields: ["id"] } });
  });
  it("refuses out-of-range or malformed values", () => {
    for (const a of [{ limit: 0 }, { limit: 501 }, { limit: 1.5 }, { offset: -1 }, { fields: "" }, { fields: Array(51).fill("a") }]) {
      expect(parseShapeArgs(a).ok, JSON.stringify(a)).toBe(false);
    }
  });
});
