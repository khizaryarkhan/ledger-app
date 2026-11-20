/**
 * Code 128 / GS1-128 encoder. Pure, no dependencies: it turns an SSCC (or any even run of digits) into the bars of a GS1-128
 * label barcode, which is what a pallet or carton label must carry (AI 00 + 18 digits). Only subset C (digit pairs) is
 * needed here: "00" + an 18-digit SSCC is 20 digits, an even run, so the whole label is one subset-C symbol with FNC1 first.
 *
 * The pattern table is the standard one, written as bar/space widths in modules (a value's six widths sum to 11, the stop
 * pattern's seven to 13). tests/code128.test.ts checks the invariants that catch a mistyped entry: the count, every width
 * sum, that the three bar widths of each symbol add to an EVEN number (Code 128's own parity rule), and that no two symbols
 * share a pattern, then encodes and decodes back.
 */

/** Widths of Code 128 values 0..105, then 106 (the stop pattern, seven elements). */
export const CODE128_WIDTHS: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

export const START_C = 105, FNC1 = 102, STOP = 106;

/** Values of a subset-C symbol: start, [FNC1], the digit pairs, the check value, stop. Throws on an odd or non-digit run. */
export function code128CValues(digits: string, opts: { fnc1?: boolean } = {}): number[] {
  if (!/^\d+$/.test(digits) || digits.length % 2 !== 0) throw new Error("Subset C encodes an even number of digits.");
  const data = [...(opts.fnc1 ? [FNC1] : []), ...(digits.match(/\d\d/g) ?? []).map(Number)];
  const check = (START_C + data.reduce((s, v, i) => s + v * (i + 1), 0)) % 103;
  return [START_C, ...data, check, STOP];
}

/** The GS1-128 values of an SSCC label barcode: FNC1, AI 00, the 18 digits. */
export const ssccBarcodeValues = (sscc18: string) => {
  if (!/^\d{18}$/.test(sscc18)) throw new Error("An SSCC is 18 digits.");
  return code128CValues(`00${sscc18}`, { fnc1: true });
};

/** The bars as [x, width] runs in modules, starting at x = 0 (the quiet zone is the renderer's), and the total width. */
export function barRuns(values: number[]): { bars: [number, number][]; width: number } {
  const bars: [number, number][] = [];
  let x = 0;
  for (const v of values) {
    const w = CODE128_WIDTHS[v];
    if (!w) throw new Error(`Not a Code 128 value: ${v}`);
    for (let i = 0; i < w.length; i++) {
      const n = Number(w[i]);
      if (i % 2 === 0) bars.push([x, n]);
      x += n;
    }
  }
  return { bars, width: x };
}

/** An SVG of the bars: `moduleMm` wide per module, `heightMm` tall, with the 10-module quiet zone either side. */
export function barcodeSvg(values: number[], opts: { moduleMm?: number; heightMm?: number } = {}): string {
  const m = opts.moduleMm ?? 0.33, h = opts.heightMm ?? 20, quiet = 10;
  const { bars, width } = barRuns(values);
  const total = (width + quiet * 2) * m;
  const rects = bars.map(([x, w]) => `<rect x="${((x + quiet) * m).toFixed(3)}" y="0" width="${(w * m).toFixed(3)}" height="${h}" />`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total.toFixed(2)}mm" height="${h}mm" viewBox="0 0 ${total.toFixed(3)} ${h}" shape-rendering="crispEdges" fill="#000">${rects}</svg>`;
}
