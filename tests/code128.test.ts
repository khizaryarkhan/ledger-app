import { describe, it, expect } from "vitest";
import { CODE128_WIDTHS, START_C, FNC1, STOP, code128CValues, ssccBarcodeValues, barRuns, barcodeSvg } from "@/lib/barcode/code128";

/** Decode bars back to symbol values: read the run widths of each 6-element symbol and look the pattern up. */
function decode(values: number[]): number[] {
  const { bars, width } = barRuns(values);
  // rebuild the alternating element widths from the bar runs
  const widths: number[] = [];
  let x = 0;
  for (const [bx, bw] of bars) { if (bx > x) widths.push(bx - x); widths.push(bw); x = bx + bw; }
  if (x < width) widths.push(width - x);
  const out: number[] = [];
  let i = 0;
  while (i < widths.length) {
    const take = CODE128_WIDTHS.findIndex((p, v) => (v === STOP ? widths.slice(i, i + 7).join("") === p : widths.slice(i, i + 6).join("") === p));
    if (take < 0) throw new Error(`no symbol at element ${i}`);
    out.push(take); i += take === STOP ? 7 : 6;
  }
  return out;
}

describe("Code 128 pattern table", () => {
  it("has 107 entries: 106 symbols of six elements summing to 11, and the 13-module stop", () => {
    expect(CODE128_WIDTHS).toHaveLength(107);
    CODE128_WIDTHS.slice(0, 106).forEach((p, v) => {
      expect(p, `value ${v}`).toMatch(/^[1-4]{6}$/);
      expect([...p].reduce((s, d) => s + Number(d), 0), `value ${v} width`).toBe(11);
    });
    expect(CODE128_WIDTHS[106]).toBe("2331112");
    expect([...CODE128_WIDTHS[106]].reduce((s, d) => s + Number(d), 0)).toBe(13);
  });

  it("every symbol's three bar widths add to an even number (Code 128's own parity rule), which catches a mistyped digit", () => {
    CODE128_WIDTHS.slice(0, 106).forEach((p, v) => {
      const bars = Number(p[0]) + Number(p[2]) + Number(p[4]);
      expect(bars % 2, `value ${v} (${p})`).toBe(0);
    });
  });

  it("no two symbols share a pattern", () => {
    expect(new Set(CODE128_WIDTHS).size).toBe(107);
  });
});

describe("GS1-128 SSCC barcode", () => {
  const SSCC = "354123450000000014";

  it("starts C, FNC1, AI 00, the pairs, a check value, stop", () => {
    const v = ssccBarcodeValues(SSCC);
    expect(v.slice(0, 4)).toEqual([START_C, FNC1, 0, 35]);
    expect(v.at(-1)).toBe(STOP);
    expect(v).toHaveLength(1 + 1 + 10 + 1 + 1);   // start, FNC1, 10 pairs (AI 00 + the 18 digits), check, stop
    const data = [FNC1, 0, 35, 41, 23, 45, 0, 0, 0, 0, 14];
    expect(v.at(-2)).toBe((START_C + data.reduce((s, x, i) => s + x * (i + 1), 0)) % 103);
  });

  it("decodes back from the bars it draws", () => {
    for (const s of [SSCC, "354123450000000021", "000000000000000000", "999999999999999999", "123456789012345675"]) {
      const v = ssccBarcodeValues(s);
      expect(decode(v)).toEqual(v);
    }
  });

  it("is 11 modules per symbol and 13 for the stop, so the same width for every SSCC", () => {
    const w = (s: string) => barRuns(ssccBarcodeValues(s)).width;
    expect(w("354123450000000014")).toBe(w("999999999999999999"));
    expect(w("354123450000000014")).toBe(11 * 13 + 13);   // 13 symbols (start, FNC1, 10 pairs, check) plus the 13-module stop
  });

  it("refuses what is not an SSCC or not an even run of digits", () => {
    expect(() => ssccBarcodeValues("12345")).toThrow(/18 digits/);
    expect(() => code128CValues("123")).toThrow(/even number/);
    expect(() => code128CValues("12a4")).toThrow(/even number/);
  });

  it("draws an SVG with one rect per bar and the quiet zone either side", () => {
    const v = ssccBarcodeValues(SSCC);
    const svg = barcodeSvg(v, { moduleMm: 0.33, heightMm: 20 });
    expect((svg.match(/<rect /g) ?? []).length).toBe(barRuns(v).bars.length);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('height="20mm"');
  });
});
