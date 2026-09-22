/**
 * Receivable Composition must never add two currencies together.
 *
 * The reported symptom: a Dashboard showing Total Receivable correctly as
 * "PKR 884,736.00" AND "€1,440.00" — two currencies, two figures — while the
 * Composition strip directly beneath it announced "What the PKR 886,176.00 is
 * made of". That total is 884,736 PKR plus 1,440 EUR, and it is a figure in no
 * currency at all. Its percentage split (99.8% / 0.2%) was arithmetic over two
 * different units, and the same blended number reached the Accounting
 * Dashboard's Receivables total.
 *
 * Nothing errors when this happens, which is why it needs a test rather than
 * care: every number on screen looks plausible, and a reader has no way to
 * tell it apart from a correct one.
 */

import { describe, it, expect } from "vitest";
import { classifyComposition, classifyCompositionByCurrency, type CompItem } from "@/lib/receivable-composition";

/** An ordinary overdue invoice — lands in "in collection". */
const open = (amount: number, currency?: string | null): CompItem & { amount: number; currency?: string | null } => ({
  amount, currency,
  escalationType: null, collectionStage: "In Collection",
  hasOpenDispute: false, promiseDate: null, overdueDays: 30,
});
/** Within terms — lands in "not yet due". */
const current = (amount: number, currency?: string | null): CompItem & { amount: number; currency?: string | null } => ({
  amount, currency,
  escalationType: null, collectionStage: "In Collection",
  hasOpenDispute: false, promiseDate: null, overdueDays: -5,
});

describe("classifyCompositionByCurrency", () => {
  it("never merges two currencies into one total", () => {
    // The exact reported figures.
    const comps = classifyCompositionByCurrency([open(884_736, "PKR"), current(1_440, "EUR")], "PKR");
    expect(comps).toHaveLength(2);
    expect(comps.map(c => [c.currency, c.total])).toEqual([["PKR", 884_736], ["EUR", 1_440]]);
    // 886,176 must appear nowhere.
    expect(comps.some(c => c.total === 886_176)).toBe(false);
  });

  it("leads with the largest currency", () => {
    const comps = classifyCompositionByCurrency([open(100, "EUR"), open(5_000, "PKR"), open(900, "GBP")], "PKR");
    expect(comps.map(c => c.currency)).toEqual(["PKR", "GBP", "EUR"]);
  });

  it("keeps each currency's percentages within that currency", () => {
    // 99.8% / 0.2% across a PKR/EUR mix was meaningless. Within one currency
    // the split is real, and each currency's parts sum to its own total.
    const comps = classifyCompositionByCurrency(
      [open(750, "PKR"), current(250, "PKR"), open(80, "EUR"), current(20, "EUR")], "PKR");
    for (const c of comps) {
      expect(c.workable + c.blocked + c.currentAmount).toBe(c.total);
    }
    const pkr = comps.find(c => c.currency === "PKR")!;
    expect(pkr.currentAmount / pkr.total).toBeCloseTo(0.25, 10);
    const eur = comps.find(c => c.currency === "EUR")!;
    expect(eur.currentAmount / eur.total).toBeCloseTo(0.2, 10);
  });

  it("treats a missing currency as the org's own, rather than dropping the row", () => {
    // Absence of a code is not evidence of a foreign currency. Excluding those
    // rows would silently under-report real debt.
    const comps = classifyCompositionByCurrency([open(100, null), open(50, undefined), open(25, "PKR")], "PKR");
    expect(comps).toHaveLength(1);
    expect(comps[0]).toMatchObject({ currency: "PKR", total: 175 });
  });

  it("normalises currency case and padding so one currency is not split in two", () => {
    const comps = classifyCompositionByCurrency([open(10, "pkr"), open(20, " PKR "), open(30, "PKR")], "PKR");
    expect(comps).toHaveLength(1);
    expect(comps[0].total).toBe(60);
  });

  it("renders a single-currency org exactly as the old classifier did", () => {
    // The common case must not change shape — this is a fix for multi-currency
    // orgs, not a redesign for everyone else.
    const rows = [open(750, "PKR"), current(250, "PKR")];
    const one = classifyCompositionByCurrency(rows, "PKR");
    const legacy = classifyComposition(rows);
    expect(one).toHaveLength(1);
    expect(one[0].total).toBe(legacy.total);
    expect(one[0].workable).toBe(legacy.workable);
    expect(one[0].currentAmount).toBe(legacy.currentAmount);
    expect(one[0].groups.map(g => g.key)).toEqual(legacy.groups.map(g => g.key));
  });

  it("handles no invoices at all", () => {
    expect(classifyCompositionByCurrency([], "PKR")).toEqual([]);
  });
});

describe("the defect this replaces", () => {
  it("classifyComposition still sums blindly — which is why callers must not feed it mixed currencies", () => {
    // Kept as the explicit record of why classifyCompositionByCurrency exists.
    // classifyComposition is correct for one currency and is still used that
    // way by the Collections Board; it simply cannot know what it was given.
    const blended = classifyComposition([open(884_736, "PKR"), current(1_440, "EUR")]);
    expect(blended.total).toBe(886_176);
  });
});
