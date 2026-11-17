/**
 * A production run that makes several output lots (one per pack) consumes its materials ONCE. A lot's trace must
 * carry only that lot's SHARE of them, or its rolled-up cost is the whole run's and never agrees with the lot's own
 * value (the "REVIEW · off by 49.20" on a two-pack order). Pure, so the rule is testable without a database.
 */

/** This lot's share (0..1) of a run's output value; 1 when it is the only output or nothing carries a value. */
export function lotShareOfRun(lotAmount: number, allOutputAmounts: number[]): number {
  const total = allOutputAmounts.reduce((s, a) => s + (Number(a) || 0), 0);
  const mine = Number(lotAmount) || 0;
  if (allOutputAmounts.length <= 1 || total <= 0.000001 || mine <= 0) return 1;
  return Math.min(1, mine / total);
}
