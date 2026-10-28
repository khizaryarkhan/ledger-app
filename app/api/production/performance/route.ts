/**
 * GET /api/production/performance?from=&to=&asOf=
 *
 * Planned vs actual for Manufacturing Orders and job work, with delay,
 * downtime and scrap reasons (0115), by the rules in
 * lib/inventory/production-performance.ts. Read-only.
 *
 * An order is in range when its due date (or, with none, its finish) falls in
 * [from, to]; an open order already past due is always included.
 */

import { db } from "@/db";
import { manufacturingOrders, productionRuns, productionDowntime, moOperations, workCentres, jobWorkOrders, apItems, parties } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, gte, lte, inArray, notInArray } from "drizzle-orm";
import { localToday } from "@/lib/format";
import { isIsoDate } from "@/lib/inventory/delivery-performance";
import {
  classifyOrderTiming, summariseTiming, paretoByReason, downtimeMinutes,
  DELAY_REASONS, DOWNTIME_REASONS, SCRAP_REASONS, reasonLabel,
} from "@/lib/inventory/production-performance";

const n = (v: unknown) => Number(v ?? 0) || 0;
const ymd = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const q = new URL(req.url).searchParams;
  const from = q.get("from"), to = q.get("to");
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) return bad("from/to must be YYYY-MM-DD");
  const asOf = isIsoDate(q.get("asOf")) ? q.get("asOf")! : localToday();
  const inRange = (d: string | null) => !!d && (!from || d >= from) && (!to || d <= to);

  // ---- Manufacturing orders ----
  const mos = (await db.select().from(manufacturingOrders)
    .where(and(eq(manufacturingOrders.orgId, orgId!), notInArray(manufacturingOrders.status, ["Cancelled", "Draft"]))))
    .map(m => {
      const finish = m.status === "Completed" ? ymd(m.completedAt) : null;
      const t = classifyOrderTiming({
        plannedStart: m.scheduledDate, plannedFinish: m.dueDate, originalFinish: m.originalDueDate ?? m.dueDate,
        actualStart: ymd(m.startedAt), actualFinish: finish, asOf,
      });
      return { m, t, finish };
    })
    .filter(({ m, t, finish }) => t.status === "Overdue" || inRange(m.dueDate ?? finish));

  // ---- Completion runs: yield, scrap, hours ----
  const runs = await db.select().from(productionRuns).where(and(
    eq(productionRuns.orgId, orgId!), eq(productionRuns.status, "Completed"),
    ...(from ? [gte(productionRuns.producedDate, from)] : []), ...(to ? [lte(productionRuns.producedDate, to)] : []),
  ));
  const moRuns = runs.filter(r => r.moId);
  const moIds = [...new Set(moRuns.map(r => r.moId!))];
  const ops = moIds.length ? await db.select().from(moOperations).where(and(eq(moOperations.orgId, orgId!), inArray(moOperations.moId, moIds))) : [];
  const opById = new Map(ops.map(o => [o.id, o]));
  const runMos = moIds.length ? await db.select({ id: manufacturingOrders.id, qty: manufacturingOrders.qty }).from(manufacturingOrders).where(and(eq(manufacturingOrders.orgId, orgId!), inArray(manufacturingOrders.id, moIds))) : [];
  const moQty = new Map(runMos.map(m => [m.id, n(m.qty)]));
  const wcs = await db.select({ id: workCentres.id, name: workCentres.name, code: workCentres.code }).from(workCentres).where(eq(workCentres.orgId, orgId!));
  const wcName = new Map(wcs.map(w => [w.id, w.code ? `${w.code} · ${w.name}` : w.name]));

  // Actual hours per work centre against the planned hours for the same output
  // (each run's share of an operation's planned hours = its share of the order).
  const hoursByWc = new Map<string, { workCentre: string; actual: number; planned: number }>();
  for (const r of moRuns) {
    const runBase = n(r.goodQty) + n(r.rejectedQty);
    const total = moQty.get(r.moId!) ?? 0;
    for (const h of (Array.isArray(r.operationHours) ? (r.operationHours as { operationId: string; hours: number }[]) : [])) {
      const op = opById.get(h.operationId);
      const key = op?.workCentreId ?? "none";
      const cur = hoursByWc.get(key) ?? { workCentre: op?.workCentreId ? (wcName.get(op.workCentreId) ?? "—") : "No work centre", actual: 0, planned: 0 };
      cur.actual += n(h.hours);
      if (op && total > 0) cur.planned += n(op.plannedHours) * Math.min(1, runBase / total);
      hoursByWc.set(key, cur);
    }
  }
  const good = runs.reduce((s, r) => s + n(r.goodQty ?? r.qtyToProduce), 0);
  const rejected = runs.reduce((s, r) => s + n(r.rejectedQty), 0);

  // ---- Downtime ----
  const dts = await db.select().from(productionDowntime).where(and(
    eq(productionDowntime.orgId, orgId!),
    ...(from ? [gte(productionDowntime.startedAt, new Date(`${from}T00:00:00Z`))] : []),
    ...(to ? [lte(productionDowntime.startedAt, new Date(`${to}T23:59:59Z`))] : []),
  ));
  const now = new Date();
  const dtRows = dts.map(d => ({ ...d, minutes: downtimeMinutes(d.startedAt, d.endedAt, now), planned: !!DOWNTIME_REASONS.find(r => r.code === d.reason)?.planned }));
  const dtByWc = new Map<string, { workCentre: string; minutes: number; unplanned: number; stops: number }>();
  for (const d of dtRows) {
    const key = d.workCentreId ?? "none";
    const cur = dtByWc.get(key) ?? { workCentre: d.workCentreId ? (wcName.get(d.workCentreId) ?? "—") : "Order only", minutes: 0, unplanned: 0, stops: 0 };
    cur.minutes += d.minutes; cur.stops += 1; if (!d.planned) cur.unplanned += d.minutes;
    dtByWc.set(key, cur);
  }

  // ---- Job work ----
  const jwos = (await db.select().from(jobWorkOrders).where(eq(jobWorkOrders.orgId, orgId!)))
    .map(j => {
      const finish = j.status === "Closed" ? (ymd(j.closedAt) ?? j.receiveDate) : null;
      const t = classifyOrderTiming({
        plannedStart: j.dispatchDate, plannedFinish: j.expectedReturnDate, originalFinish: j.originalExpectedReturnDate ?? j.expectedReturnDate,
        actualStart: j.dispatchDate, actualFinish: finish, asOf,
      });
      return { j, t, finish };
    })
    .filter(({ j, t, finish }) => t.status === "Overdue" || inRange(j.expectedReturnDate ?? finish ?? j.dispatchDate));
  const vendorIds = [...new Set(jwos.map(x => x.j.vendorId).filter((v): v is string => !!v))];
  const vendors = vendorIds.length ? await db.select({ id: parties.id, name: parties.name }).from(parties).where(and(eq(parties.orgId, orgId!), inArray(parties.id, vendorIds))) : [];
  const vendorName = new Map(vendors.map(v => [v.id, v.name]));
  const vendorOf = (j: typeof jobWorkOrders.$inferSelect) => (j.vendorId && vendorName.get(j.vendorId)) || j.vendorLabel || "—";
  const byVendor = new Map<string, { vendor: string; rows: typeof jwos; sent: number; received: number; wastage: number }>();
  for (const x of jwos) {
    const key = x.j.vendorId ?? x.j.vendorLabel ?? "—";
    const cur = byVendor.get(key) ?? { vendor: vendorOf(x.j), rows: [], sent: 0, received: 0, wastage: 0 };
    cur.rows.push(x);
    if (x.j.status === "Closed") { cur.sent += n(x.j.sentQty); cur.received += n(x.j.sentQty) - n(x.j.wastageQty); cur.wastage += n(x.j.wastageAmount); }
    byVendor.set(key, cur);
  }

  const itemIds = [...new Set(mos.map(x => x.m.outputItemId))];
  const items = itemIds.length ? await db.select({ id: apItems.id, name: apItems.name }).from(apItems).where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, itemIds))) : [];
  const itemName = new Map(items.map(i => [i.id, i.name]));
  const lateMos = mos.filter(x => x.t.scored && !x.t.onTime);
  const lateJw = jwos.filter(x => x.t.scored && !x.t.onTime);

  return ok({
    asOf, from, to,
    production: {
      timing: summariseTiming(mos.map(x => ({ t: x.t, revisions: x.m.rescheduleCount }))),
      yieldPct: good + rejected > 0 ? r1((good / (good + rejected)) * 100) : null,
      goodQty: r2(good), rejectedQty: r2(rejected),
      scrapCost: r2(runs.reduce((s, r) => s + n(r.scrapCost), 0)),
      hours: [...hoursByWc.values()].map(h => ({ ...h, actual: r1(h.actual), planned: r1(h.planned), efficiencyPct: h.actual > 0 ? r1((h.planned / h.actual) * 100) : null })),
      delayReasons: paretoByReason(DELAY_REASONS, lateMos, x => x.m.delayReason, () => 1),
      scrapReasons: paretoByReason(SCRAP_REASONS, runs.filter(r => n(r.rejectedQty) > 0), r => r.rejectReason, r => n(r.rejectedQty)),
      orders: mos.filter(x => x.t.status !== "Open" || x.m.rescheduleCount > 0).map(x => ({
        id: x.m.id, moNo: x.m.moNo, item: itemName.get(x.m.outputItemId) ?? "—", status: x.m.status, timing: x.t.status,
        plannedStart: x.m.scheduledDate, actualStart: ymd(x.m.startedAt), due: x.m.dueDate, originalDue: x.m.originalDueDate,
        finish: x.finish, daysLate: x.t.finishSlipDays, reschedules: x.m.rescheduleCount,
        delayReason: x.m.delayReason ? reasonLabel(DELAY_REASONS, x.m.delayReason) : null, delayNote: x.m.delayNote,
      })),
    },
    downtime: {
      totalMinutes: dtRows.reduce((s, d) => s + d.minutes, 0),
      unplannedMinutes: dtRows.filter(d => !d.planned).reduce((s, d) => s + d.minutes, 0),
      stops: dtRows.length,
      open: dtRows.filter(d => !d.endedAt).length,
      reasons: paretoByReason(DOWNTIME_REASONS, dtRows, d => d.reason, d => d.minutes),
      byWorkCentre: [...dtByWc.values()].sort((a, b) => b.minutes - a.minutes),
    },
    jobWork: {
      timing: summariseTiming(jwos.map(x => ({ t: x.t, revisions: x.j.returnRevisions }))),
      delayReasons: paretoByReason(DELAY_REASONS, lateJw, x => x.j.delayReason, () => 1),
      wastageReasons: paretoByReason(SCRAP_REASONS, jwos.filter(x => n(x.j.wastageQty) > 0), x => x.j.wastageReason, x => n(x.j.wastageAmount)),
      vendors: [...byVendor.values()].map(v => ({
        vendor: v.vendor, ...summariseTiming(v.rows.map(x => ({ t: x.t, revisions: x.j.returnRevisions }))),
        yieldPct: v.sent > 0 ? r1((v.received / v.sent) * 100) : null, wastageValue: r2(v.wastage),
      })).sort((a, b) => (a.onTimePct ?? 101) - (b.onTimePct ?? 101)),
      orders: jwos.filter(x => x.t.status !== "Open" || x.j.returnRevisions > 0).map(x => ({
        id: x.j.id, docNumber: x.j.docNumber, vendor: vendorOf(x.j), status: x.j.status, timing: x.t.status,
        dispatched: x.j.dispatchDate, due: x.j.expectedReturnDate, originalDue: x.j.originalExpectedReturnDate,
        finish: x.finish, daysLate: x.t.finishSlipDays, revisions: x.j.returnRevisions,
        delayReason: x.j.delayReason ? reasonLabel(DELAY_REASONS, x.j.delayReason) : null, delayNote: x.j.delayNote,
      })),
    },
  });
}
