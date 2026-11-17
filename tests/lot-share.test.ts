import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { lotShareOfRun } from "@/lib/inventory/lot-share";

describe("a lot's share of a multi-output production run", () => {
  it("takes its share of the run's output value (the 49.20 of 98.40 that read 'off by 49.20')", () => {
    expect(lotShareOfRun(49.2, [49.2, 49.2])).toBeCloseTo(0.5, 10);
    expect(lotShareOfRun(30, [30, 70])).toBeCloseTo(0.3, 10);
  });

  it("is the whole run for a single output, or when nothing carries a value", () => {
    expect(lotShareOfRun(98.4, [98.4])).toBe(1);
    expect(lotShareOfRun(0, [0, 0])).toBe(1);
    expect(lotShareOfRun(0, [10, 20])).toBe(1);
  });

  it("the trace applies it to the production edges", () => {
    const src = readFileSync("lib/inventory/genealogy.ts", "utf8");
    expect(src).toContain("lotShareOfRun(");
  });
});
