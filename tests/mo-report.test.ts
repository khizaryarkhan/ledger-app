import { describe, it, expect } from "vitest";
import { buildMoReportHtml, computeInsights, daysBetween, type MoReportData } from "@/lib/inventory/mo-report";

function data(over: Partial<MoReportData> = {}): MoReportData {
  return {
    orgName: "Star Health", logoUrl: null,
    mo: {
      moNo: "MO-0001", status: "Completed", productName: "Soothing Spray", baseUom: "oz", priority: "Normal",
      scheduledDate: "2026-10-30", dueDate: "2026-10-30", originalDueDate: "2026-10-30", rescheduleCount: 0, delayReason: null, delayNote: null,
      startedAt: "2026-10-30T20:34:00.000Z", completedAt: "2026-10-30T20:50:00.000Z", createdBy: "Wajahat", notes: null, expYield: null,
    },
    outputs: [{ label: "4 oz bottle [011]", plannedPacks: 16650, producedPacks: 10000, unitContent: 4, baseUom: "oz", lotNo: "26306-1", bestBefore: null, expiryDate: null, cost: 400, unitCost: 0.01 }],
    materials: [
      { name: "Aloe", kind: "ingredient", uom: "g", planned: 1000, used: 1000, cost: 50, substitutes: [] },
      { name: "Bottle", kind: "packaging", uom: "bottle", planned: 16650, used: 10000, cost: 100, substitutes: [] },
    ],
    lots: [], operations: [],
    runs: [{ runNo: "BUILD-1", date: "2026-10-30", good: 40000, rejected: 0, materialCost: 150, labourCost: 20, overheadCost: 10, scrapCost: 0, rejectReason: null }],
    ...over,
  };
}

describe("MO report insights", () => {
  it("reports made-vs-plan, cost and yield from the runs", () => {
    const i = computeInsights(data());
    expect(i.plannedBase).toBe(66600);
    expect(i.producedVsPlanPct).toBe(60.1);
    expect(i.costs.total).toBe(180);
    expect(i.costPerGoodBase).toBeCloseTo(180 / 40000, 8);
    expect(i.yieldPct).toBe(100);
    expect(i.cycleHours).toBe(0.27);
  });

  it("calls out a short run and flags materials more than 5% off plan", () => {
    const i = computeInsights(data());
    expect(i.findings.some(f => f.tone === "bad" && /60\.1%/.test(f.text))).toBe(true);
    const bottle = i.materialVariances.find(v => v.name === "Bottle")!;
    expect(bottle.flagged).toBe(true);
    expect(bottle.pct).toBe(-39.9);
    expect(i.materialVariances.find(v => v.name === "Aloe")!.flagged).toBe(false);
  });

  it("scores lateness from the due date with no timezone parsing", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    const late = computeInsights(data({ mo: { ...data().mo, dueDate: "2026-10-28" } }));
    expect(late.daysLate).toBe(2);
    expect(late.findings.some(f => /2 days after the due date/.test(f.text))).toBe(true);
  });

  it("says nothing was produced rather than inventing figures for an order with no runs", () => {
    const open = data({ runs: [], mo: { ...data().mo, status: "Released", startedAt: null, completedAt: null } });
    const i = computeInsights(open);
    expect(i.yieldPct).toBeNull();
    expect(i.costPerGoodBase).toBeNull();
    expect(i.findings).toEqual([]);
    expect(buildMoReportHtml(open).html).toContain("nothing to assess");
  });

  it("flags yield below the recipe's expectation, accepting a fraction or a percentage", () => {
    const runs = [{ ...data().runs[0], good: 900, rejected: 100 }];
    expect(computeInsights(data({ runs, mo: { ...data().mo, expYield: 0.95 } })).findings.some(f => /below the 95%/.test(f.text))).toBe(true);
    expect(computeInsights(data({ runs, mo: { ...data().mo, expYield: 95 } })).findings.some(f => /below the 95%/.test(f.text))).toBe(true);
  });
});

describe("MO report HTML", () => {
  it("uses the statement's masthead (monogram when there is no logo) and escapes names", () => {
    const { html, footerTemplate } = buildMoReportHtml(data({ orgName: "A <b>& Co" }));
    expect(html).toContain('class="mono"');
    expect(html).toContain("A &lt;b&gt;&amp; Co");
    expect(html).not.toContain("<b>&");
    expect(footerTemplate).toContain("pageNumber");
  });

  it("leads with the BOM, groups materials by what they are for with a unit cost, and totals each output pack", () => {
    const d = data({
      mo: { ...data().mo, bomCode: "BOM-EMP-01", bomName: "Empanada dough" },
      materials: [
        { name: "Aloe", kind: "ingredient", uom: "g", planned: 1000, used: 1000, cost: 50, substitutes: [] },
        { name: "Bottle", kind: "packaging", uom: "bottle", planned: 100, used: 100, cost: 25, substitutes: [], forPack: "4 oz bottle [011]" },
      ],
      runs: [{ ...data().runs[0], packs: "100 × 4 oz bottle [011]" }],
    });
    const { html } = buildMoReportHtml(d);
    expect(html).toContain("BOM-EMP-01 · Empanada dough");
    expect(html).not.toContain(">Soothing Spray<");
    expect(html).toContain("Ingredients (used across every pack)");
    expect(html).toContain("Packaging for 4 oz bottle [011]");
    expect(html).toContain("0.05 / g");
    expect(html).toContain("Total output cost");
    expect(html).toContain("Pack of 4 oz");
    expect(html).not.toContain("Difference");
    expect(html).toContain("<th>Expiry</th>");
    expect(html).toContain("<th>Product</th>");
    // Output and Materials share one column grid so their headings line up.
    expect((html.match(/<colgroup>.*?<\/colgroup>/g) ?? []).length).toBe(2);
    expect(new Set(html.match(/<colgroup>.*?<\/colgroup>/g)).size).toBe(1);
    expect(html).not.toContain("Planned (packs)");
    expect(html).toContain("production run number");
    expect(html).toContain("100 × 4 oz bottle [011]");
  });

  it("refuses an unsafe logo and shows each section the order has data for", () => {
    const { html } = buildMoReportHtml(data({ logoUrl: "javascript:alert(1)" }));
    expect(html).not.toContain("javascript:");
    for (const h of ["What stood out", "Output", "Materials: planned vs used", "Cost build-up", "Completions"]) expect(html).toContain(h);
    expect(html).not.toContain("Lot traceability");
  });
});
