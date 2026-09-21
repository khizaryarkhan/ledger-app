/**
 * Money and quantity display rules (set 2026-09-21).
 *
 *   MONEY  minimum 2 decimals, up to 6, trailing zeros beyond the 2nd stripped
 *   QTY    up to 5 decimals, never padded
 *
 * The two instructions behind this — "at least N decimals" and "no trailing
 * zeros" — pull against each other, and the resolution differs by kind: money
 * treats 2 as a FLOOR because currency always shows cents, while a quantity of
 * ten is "10", not "10.00000".
 *
 * This REVERSES a previously deliberate rule (fmt.money rounded to whole
 * numbers "for scannability"), so it is pinned here rather than left to be
 * re-derived — the next person to find `maximumFractionDigits: 0` in a diff
 * should find a failing test, not a plausible-looking optimisation.
 */
import { describe, it, expect } from "vitest";
import { fmt } from "@/lib/format";

/** Strip currency symbols and NBSPs so assertions are about the DIGITS. */
const digits = (s: string) => s.replace(/[^\d.,\-<>]/g, "").trim();

describe("money shows at least two decimals", () => {
  it("pads a whole number to two", () => {
    expect(digits(fmt.money(100, "EUR"))).toBe("100.00");
    expect(digits(fmt.money(0, "EUR"))).toBe("0.00");
  });

  it("pads one decimal to two", () => {
    expect(digits(fmt.money(1234.5, "EUR"))).toBe("1,234.50");
  });

  it("keeps a third decimal when the value has one", () => {
    // Unit costs are numeric(18,6) — rounding them to cents would misstate cost.
    expect(digits(fmt.money(1234.567, "EUR"))).toBe("1,234.567");
  });

  it("keeps up to six decimals", () => {
    expect(digits(fmt.money(1.234567, "EUR"))).toBe("1.234567");
  });

  it("strips trailing zeros BEYOND the two-decimal floor", () => {
    // 1.234500 must not render as "1.234500", and must not collapse to "1.2345"
    // losing the floor either — the floor only applies below two places.
    expect(digits(fmt.money(1.2345, "EUR"))).toBe("1.2345");
    expect(digits(fmt.money(1.2, "EUR"))).toBe("1.20");
  });

  it("never rounds cents away — the rule this replaced", () => {
    // The old behaviour returned "€1,235" for this. An accounting product that
    // hides cents is not scannable, it is wrong.
    expect(digits(fmt.money(1234.56, "EUR"))).toBe("1,234.56");
    expect(digits(fmt.money(1234.56, "EUR"))).not.toBe("1,235");
  });

  it("handles a nonsense currency code instead of throwing", () => {
    // "?" reaches this from placeholder rows; Intl throws RangeError on it.
    expect(() => fmt.money(10, "?" as any)).not.toThrow();
    expect(digits(fmt.money(10, "?" as any))).toContain("10.00");
  });

  it("renders null and NaN as a dash, not as zero", () => {
    expect(fmt.money(null)).toBe("—");
    expect(fmt.money(undefined)).toBe("—");
    expect(fmt.money(NaN)).toBe("—");
  });
});

describe("quantity shows up to five decimals and never pads", () => {
  it("leaves a whole number alone", () => {
    expect(fmt.qty(10)).toBe("10");
    expect(fmt.qty(0)).toBe("0");
  });

  it("does not pad a short decimal", () => {
    expect(fmt.qty(10.5)).toBe("10.5");
  });

  it("keeps five decimals", () => {
    expect(fmt.qty(10.12345)).toBe("10.12345");
  });

  it("rounds beyond five rather than truncating", () => {
    expect(fmt.qty(10.123456)).toBe("10.12346");
  });

  it("strips trailing zeros", () => {
    expect(fmt.qty(10.123450)).toBe("10.12345");
    expect(fmt.qty(10.10000)).toBe("10.1");
  });

  it("accepts the string form Drizzle returns for numeric columns", () => {
    // Every qty column is numeric(_,4) and comes back as a string.
    expect(fmt.qty("10.5000")).toBe("10.5");
    expect(fmt.qty("0.0000")).toBe("0");
  });

  it("a non-zero quantity never prints as zero", () => {
    // 0.000001 rounds to "0" at five decimals, which tells the reader there is
    // no stock when there is some. That is a lie rather than an imprecision.
    expect(fmt.qty(0.000001)).not.toBe("0");
    expect(fmt.qty(0.000001)).toContain("<");
    expect(fmt.qty(-0.000001)).not.toBe("0");
    expect(fmt.qty(-0.000001)).toContain(">");
  });

  it("treats a true zero as zero", () => {
    expect(fmt.qty(0)).toBe("0");
    expect(fmt.qty(null)).toBe("0");
  });
});

describe("num2 and money agree", () => {
  it("num2 is money without the symbol, same decimals", () => {
    expect(fmt.num2(1234.5)).toBe("1,234.50");
    expect(fmt.num2(1234.567)).toBe("1,234.567");
    expect(fmt.num2(100)).toBe("100.00");
  });

  it("a figure does not change shape between the two", () => {
    // The same amount rendered in a ledger column (num2) and a summary card
    // (money) must not differ in decimals, or the two appear to disagree.
    for (const n of [0, 1.2, 100, 1234.5, 1234.567, 1.234567]) {
      expect(digits(fmt.money(n, "EUR"))).toBe(fmt.num2(n));
    }
  });
});
