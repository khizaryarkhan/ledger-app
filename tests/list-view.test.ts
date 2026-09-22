import { describe, it, expect } from "vitest";
import { sumByCurrency } from "@/components/list-view";
import { fmt } from "@/lib/format";

// Every list screen's toolbar and footer total goes through sumByCurrency.
// The Dashboard once added rupees to euros; a list total must never do that.
describe("sumByCurrency", () => {
  const money = (r: { amt: number; ccy?: string | null }) => ({ amount: r.amt, currency: r.ccy });

  it("keeps each currency separate", () => {
    expect(sumByCurrency([{ amt: 100, ccy: "EUR" }, { amt: 50, ccy: "PKR" }, { amt: 25, ccy: "EUR" }], money))
      .toEqual({ EUR: 125, PKR: 50 });
  });

  it("files a missing or invalid code under the currency fmt.money would print", () => {
    // fmt.money renders a non-ISO code as EUR; the total must key the same way
    // or a blank and an explicit EUR show as two separate € lines.
    expect(fmt.money(1, "?")).toBe(fmt.money(1, "EUR"));
    expect(sumByCurrency([{ amt: 10, ccy: null }, { amt: 5, ccy: "?" }, { amt: 1, ccy: "EUR" }], money))
      .toEqual({ EUR: 16 });
  });

  it("keeps cents", () => {
    expect(sumByCurrency([{ amt: 0.1, ccy: "USD" }, { amt: 0.2, ccy: "USD" }], money).USD).toBeCloseTo(0.3, 10);
  });
});
