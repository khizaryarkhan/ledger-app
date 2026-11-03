import { describe, it, expect } from "vitest";
import { totalsByCurrency, homeTotal, headlineTotal } from "@/lib/ar-currency";

const today = "2026-11-03";

describe("totalsByCurrency", () => {
  it("never adds one currency to another (EDC: EUR and GBP were summed as EUR)", () => {
    const rows = totalsByCurrency([
      { currency: "EUR", balance: 1000, dueDate: "2026-12-01" },
      { currency: "GBP", balance: 500, dueDate: "2026-10-01" },
      { currency: "EUR", balance: 250.5, dueDate: "2026-10-01" },
    ], "EUR", today);
    expect(rows).toEqual([
      { currency: "EUR", total: 1250.5, overdue: 250.5, openCount: 2 },
      { currency: "GBP", total: 500, overdue: 500, openCount: 1 },
    ]);
  });
  it("puts home first even when another currency is larger, then largest first", () => {
    const rows = totalsByCurrency([
      { currency: "USD", balance: 10, dueDate: null },
      { currency: "GBP", balance: 900, dueDate: null },
      { currency: "EUR", balance: 5, dueDate: null },
    ], "eur", today);
    expect(rows.map((r) => r.currency)).toEqual(["EUR", "GBP", "USD"]);
  });
  it("treats a blank currency as home, and compares due dates as dates", () => {
    const rows = totalsByCurrency([
      { currency: null, balance: 10, dueDate: "2026-11-03" }, // due today: not overdue
      { currency: "", balance: 5, dueDate: "2026-11-02" },
    ], "GBP", today);
    expect(rows).toEqual([{ currency: "GBP", total: 15, overdue: 5, openCount: 2 }]);
  });
  it("rounds to cents without drifting", () => {
    const rows = totalsByCurrency(Array.from({ length: 10 }, () => ({ currency: "EUR", balance: 0.1, dueDate: null })), "EUR", today);
    expect(rows[0].total).toBe(1);
  });
});

describe("headlineTotal", () => {
  const t = (c: string, total: number) => ({ currency: c, total, overdue: 0, openCount: 1 });
  it("leads with home when anything is open in it", () => {
    expect(headlineTotal([t("EUR", 5), t("GBP", 900)], "EUR").currency).toBe("EUR");
  });
  it("leads with the only currency in use, not a zero home figure (ACC: EUR org, all USD)", () => {
    expect(headlineTotal([t("USD", 240093)], "EUR")).toEqual(t("USD", 240093));
  });
  it("with several non-home currencies, stays home at zero rather than pick or sum", () => {
    expect(headlineTotal([t("USD", 10), t("GBP", 20)], "EUR")).toEqual({ currency: "EUR", total: 0, overdue: 0, openCount: 0 });
  });
  it("nothing open at all reads as home zero", () => {
    expect(headlineTotal([], "GBP").total).toBe(0);
  });
});

describe("homeTotal", () => {
  it("returns zeros when nothing is open in the home currency", () => {
    expect(homeTotal(totalsByCurrency([{ currency: "GBP", balance: 1, dueDate: null }], "EUR", today), "EUR"))
      .toEqual({ currency: "EUR", total: 0, overdue: 0, openCount: 0 });
  });
});
