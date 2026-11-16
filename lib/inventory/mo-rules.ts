/**
 * Pure decisions behind completing a manufacturing order (no db, client-safe).
 * mo-completion.ts reads the facts, these functions decide, so each rule is
 * provable in tests/mo-completion-rules.test.ts.
 */

const EPS = 1e-6;
const roundQ = (n: number) => Math.round(n * 1e6) / 1e6;

export type MaterialRow = { kind: string; forSkuId: string | null; plannedQty: number };

/** Fraction of each output pack still to make that this run makes (0..1). Key "" = the base unit. */
export function skuRunFractions(
  outputs: { skuId: string; remaining: number }[],
  good: { skuId: string; goodPacks: number }[],
): Map<string, number> {
  const goodBy = new Map(good.map(g => [g.skuId, g.goodPacks]));
  const out = new Map<string, number>();
  for (const o of outputs) {
    const g = goodBy.get(o.skuId) ?? 0;
    out.set(o.skuId, o.remaining > EPS ? Math.min(1, Math.max(0, g / o.remaining)) : 0);
  }
  return out;
}

/**
 * Default quantity a PARTIAL run consumes from one allocation. Ingredients scale by the run's
 * share of what is left to make. Packaging tied to a pack scales by THAT pack's fraction made this
 * run, so a run that makes only some SKUs does not use up the packaging of the SKUs it did not make.
 * An item that is both is weighted by planned use. A final run uses everything allocated.
 */
export function defaultConsumeQty(a: {
  allocQty: number; rows: MaterialRow[]; share: number; final: boolean; skuFraction: Map<string, number>;
}): number {
  if (a.final) return roundQ(a.allocQty);
  const packRows = a.rows.filter(r => r.kind === "packaging" && r.forSkuId);
  if (!packRows.length) return roundQ(a.allocQty * a.share);
  const ingQty = a.rows.filter(r => !(r.kind === "packaging" && r.forSkuId)).reduce((s, r) => s + r.plannedQty, 0);
  const packQty = packRows.reduce((s, r) => s + r.plannedQty, 0);
  const total = ingQty + packQty;
  if (total <= 0) return roundQ(a.allocQty * a.share);
  const packWeighted = packRows.reduce((s, r) => s + r.plannedQty * (a.skuFraction.get(r.forSkuId!) ?? 0), 0);
  return roundQ(a.allocQty * (ingQty * a.share + packWeighted) / total);
}

export type ConsumedLot = { lotId: string; lotNo: string | null; receivedDate: string | null; expiryDate: string | null; reason: string | null };

/** A completion cannot be dated before stock it consumes was received. Future dates are not refused here. */
export function dateBeforeLotError(date: string, lots: ConsumedLot[]): string | null {
  for (const l of lots) {
    if (l.receivedDate && date < l.receivedDate) {
      return `The completion date ${date} is before lot ${l.lotNo ?? l.lotId} was received (${l.receivedDate}). Use a date on or after it.`;
    }
  }
  return null;
}

/** Lots expired as at the completion date (expiry strictly before it). */
export function expiredAsAt(date: string, lots: ConsumedLot[]): ConsumedLot[] {
  return lots.filter(l => l.expiryDate && l.expiryDate < date);
}

/** An expired lot may be consumed only when its allocation carries a reason. */
export function expiredWithoutReasonError(date: string, lots: ConsumedLot[]): string | null {
  const bad = expiredAsAt(date, lots).find(l => !(l.reason ?? "").trim());
  return bad
    ? `Lot ${bad.lotNo ?? bad.lotId} expired on ${bad.expiryDate}, before the completion date ${date}. Re-allocate it with a reason to use it.`
    : null;
}

/** Audit meta for expired lots a run consumed. */
export function expiredLotAudit(date: string, lots: ConsumedLot[]) {
  const x = expiredAsAt(date, lots);
  return x.length ? { date, lots: x.map(l => ({ lotNo: l.lotNo, expiryDate: l.expiryDate, reason: (l.reason ?? "").trim() })) } : null;
}

/** A void leaves the order Completed only if nothing was taken back; otherwise it is InProgress. */
export function statusAfterVoid(current: string): string {
  return current === "Completed" ? "InProgress" : current;
}
