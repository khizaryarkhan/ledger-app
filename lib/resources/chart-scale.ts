/**
 * A readable value axis for a bar chart (pure). Picks a step from 1, 2, 2.5, 5
 * times a power of ten so the axis ends on a round number just past the largest
 * bar, with roughly `target` gridlines. Never returns an empty axis.
 */
export interface Scale { max: number; step: number; ticks: number[] }

export function niceScale(rawMax: number, target = 5): Scale {
  const max = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 1;
  const rough = max / Math.max(1, target);
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 1e6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max: top, step, ticks };
}
