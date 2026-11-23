import { describe, it, expect, afterEach } from "vitest";
import { fmt, setDefaultCurrency, getDefaultCurrency } from "@/lib/format";

// A caller that names no currency used to print euros for every organisation,
// so a dollar company saw "€0.00" on reports. It now follows the organisation.
describe("default currency", () => {
  afterEach(() => setDefaultCurrency("EUR"));

  it("prints in the organisation's currency when none is given", () => {
    setDefaultCurrency("USD");
    expect(fmt.money(0)).toContain("$");
    expect(fmt.money(0)).not.toContain("€");
  });

  it("an explicit currency still wins", () => {
    setDefaultCurrency("USD");
    expect(fmt.money(10, "EUR")).toContain("€");
  });

  it("a placeholder code falls back to the organisation's currency", () => {
    setDefaultCurrency("GBP");
    expect(fmt.money(5, "?")).toContain("£");
  });

  it("ignores a malformed default", () => {
    setDefaultCurrency("USD");
    setDefaultCurrency("dollars");
    expect(getDefaultCurrency()).toBe("USD");
  });
});
