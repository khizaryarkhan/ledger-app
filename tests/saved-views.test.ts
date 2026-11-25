import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseViewInput, sanitizeParams, pickOption, pickDate, nameKey, isReportKey, MAX_PARAMS } from "@/lib/reports/saved-views";

describe("saved report views", () => {
  it("accepts a named set of settings and trims the name", () => {
    const r = parseViewInput({ reportKey: "statement:profit-loss", name: "  Quarterly   by class ", params: { rangePreset: "this_quarter", columns: "class" } });
    expect(r).toEqual({ ok: true, value: { reportKey: "statement:profit-loss", name: "Quarterly by class", params: { rangePreset: "this_quarter", columns: "class" } } });
  });

  it("refuses a bad report key, a blank or long name, and an empty view", () => {
    expect(parseViewInput({ reportKey: "../x", name: "a", params: { a: 1 } }).ok).toBe(false);
    expect(parseViewInput({ reportKey: "statement:profit-loss", name: "   ", params: { a: 1 } }).ok).toBe(false);
    expect(parseViewInput({ reportKey: "statement:profit-loss", name: "x".repeat(81), params: { a: 1 } }).ok).toBe(false);
    expect(parseViewInput({ reportKey: "statement:profit-loss", name: "ok", params: {} }).ok).toBe(false);
    expect(isReportKey("Statement")).toBe(false);
  });

  it("keeps only plain settings: nested values, odd keys, long strings and extra keys are dropped", () => {
    const raw: any = { good: "a", n: 2, flag: true, nested: { x: 1 }, list: [1], "bad key": "x", "9x": "x", long: "y".repeat(65), nan: NaN };
    expect(sanitizeParams(raw)).toEqual({ good: "a", n: 2, flag: true });
    const many: any = {}; for (let i = 0; i < 40; i++) many[`k${i}`] = i;
    expect(Object.keys(sanitizeParams(many))).toHaveLength(MAX_PARAMS);
    expect(sanitizeParams(null)).toEqual({});
    expect(sanitizeParams([1, 2])).toEqual({});
  });

  it("applies a stored option only if the report still offers it", () => {
    expect(pickOption("quarter", ["month", "quarter"] as const, "month")).toBe("quarter");
    expect(pickOption("decade", ["month", "quarter"] as const, "month")).toBe("month");
    expect(pickOption(5, ["month", "quarter"] as const, "month")).toBe("month");
  });

  it("applies a stored date only if it is a real calendar day", () => {
    expect(pickDate("2026-02-28", "2026-01-01")).toBe("2026-02-28");
    expect(pickDate("2028-02-29", "2026-01-01")).toBe("2028-02-29");
    expect(pickDate("2026-02-29", "2026-01-01")).toBe("2026-01-01");
    expect(pickDate("2026-13-01", "2026-01-01")).toBe("2026-01-01");
    expect(pickDate("26-1-1", "2026-01-01")).toBe("2026-01-01");
    expect(pickDate(undefined, "2026-01-01")).toBe("2026-01-01");
  });

  it("two names that differ only by case or spacing are the same name", () => {
    expect(nameKey("Quarterly  View")).toBe(nameKey(" quarterly view "));
  });
});

describe("saved views wiring", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("the API route scopes every query to the signed-in org AND user, and the page re-checks stored values", () => {
    const route = read("app/api/accounting/report-views/route.ts");
    expect(route).toMatch(/eq\(reportViews\.userId/);
    expect(route).toMatch(/eq\(reportViews\.orgId/);
    const page = read("app/(app)/accounting/reports/[statement]/page.tsx");
    expect(page).toMatch(/pickOption\(/);
  });

  it("every report with a Views menu re-checks stored values before applying them", () => {
    for (const p of [
      "app/(app)/accounting/reports/[statement]/page.tsx",
      "app/(app)/accounting/reports/general-ledger/page.tsx",
      "app/(app)/accounting/reports/budget-vs-actual/page.tsx",
    ]) {
      const src = read(p);
      expect(src, p).toMatch(/<SavedViewsMenu /);
      expect(src, p).toMatch(/pickOption\(/);
    }
  });
});
