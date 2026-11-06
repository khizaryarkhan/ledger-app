/**
 * The db half of the machine utilisation report.
 *
 * One read per kind of record for the whole org, then a per-machine fold, so a
 * shop with forty machines costs the same handful of queries as one with two.
 * Every query takes orgId first.
 *
 * Cost is built only when `includeCost` is true (organisation admins): the work
 * centre's labour rate is a wage rate, and the register's NBV is a balance-sheet
 * figure, neither of which a floor supervisor looking at utilisation needs.
 */

import { db } from "@/db";
import { resources, workCentres, fixedAssets, productionDowntime } from "@/db/schema";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { usageForWorkCentre, isFirm, splitDowntime, type MachineDowntimeRow, type MachineUsage } from "./machine";
import { availableHours, utilisation, depreciationInWindow, runningCost, type AvailableHours, type Utilisation } from "./machine-report";
import { loadCompletionRuns } from "./machine-server";
import { loadCalendars } from "./reports-server";
import { toTerms } from "@/lib/accounting/fixed-assets-server";
import { netBookValueAsAt } from "@/lib/accounting/fixed-assets";
import { DOWNTIME_REASONS, paretoByReason } from "@/lib/inventory/production-performance";

export interface MachineReportRow {
  resourceId: string;
  name: string;
  workCentre: { id: string; name: string; code: string | null };
  usage: MachineUsage;
  /** True only when every run hour was typed by a person. */
  firm: boolean;
  available: AvailableHours;
  utilisation: Utilisation;
  downtime: {
    plannedMinutes: number;
    unplannedMinutes: number;
    reasons: { code: string; label: string; count: number; value: number }[];
  };
  /** Admins only. Running cost and depreciation sit side by side and are never summed. */
  cost?: {
    labourRate: number;
    overheadRate: number;
    runningCost: { labour: number; overhead: number; total: number };
    asset: { id: string; name: string; depreciation: number; netBookValue: number } | null;
  };
}

export interface MachineReport {
  from: string;
  to: string;
  machines: MachineReportRow[];
  /** Active machines with no work centre: nothing can be derived for them. */
  unlinked: { id: string; name: string }[];
}

export async function loadMachineReport(
  orgId: string, from: string, to: string, includeCost: boolean, now: Date = new Date(),
): Promise<MachineReport> {
  const machines = await db.select({
    id: resources.id, name: resources.name, workCentreId: resources.workCentreId,
    fixedAssetId: resources.fixedAssetId, workingDays: resources.workingDays,
  }).from(resources).where(and(
    eq(resources.orgId, orgId), eq(resources.type, "equipment"), eq(resources.status, "active"),
  ));

  const linked = machines.filter((m) => m.workCentreId);
  const unlinked = machines.filter((m) => !m.workCentreId).map((m) => ({ id: m.id, name: m.name }));
  if (!linked.length) return { from, to, machines: [], unlinked };

  const wcIds = Array.from(new Set(linked.map((m) => m.workCentreId as string)));
  const assetIds = linked.map((m) => m.fixedAssetId).filter((v): v is string => !!v);

  const [wcRows, { runs, operationWorkCentre }, cal, downRows, assetRows] = await Promise.all([
    db.select({
      id: workCentres.id, name: workCentres.name, code: workCentres.code,
      labourRate: workCentres.labourRate, overheadRate: workCentres.overheadRate,
    }).from(workCentres).where(and(eq(workCentres.orgId, orgId), inArray(workCentres.id, wcIds))),
    loadCompletionRuns(orgId, from, to),
    loadCalendars(orgId, linked.map((m) => m.id)),
    db.select().from(productionDowntime).where(and(
      eq(productionDowntime.orgId, orgId), inArray(productionDowntime.workCentreId, wcIds),
      gte(productionDowntime.startedAt, new Date(`${from}T00:00:00Z`)),
      lte(productionDowntime.startedAt, new Date(`${to}T23:59:59Z`)),
    )),
    includeCost && assetIds.length
      ? db.select().from(fixedAssets).where(and(eq(fixedAssets.orgId, orgId), inArray(fixedAssets.id, assetIds)))
      : Promise.resolve([] as (typeof fixedAssets.$inferSelect)[]),
  ]);

  const wcById = new Map(wcRows.map((w) => [w.id, w]));
  const assetById = new Map(assetRows.map((a) => [a.id, a]));

  const windowEnd = new Date(`${to}T23:59:59Z`); // the same convention as the downtime query above
  const rows: MachineReportRow[] = [];
  for (const m of linked) {
    const wc = wcById.get(m.workCentreId as string);
    if (!wc) continue;  // a work centre outside this org cannot be reached; skipped, never shown

    const usage = usageForWorkCentre(wc.id, runs, operationWorkCentre, from, to);
    const c = cal.calendars.get(m.id);
    const available = availableHours(from, to, c?.workingHours ?? [], m.workingDays ?? null, c?.holidays ?? new Set<string>());

    const dtRows: MachineDowntimeRow[] = downRows
      .filter((d) => d.workCentreId === wc.id)
      .map((d) => ({
        id: d.id, startedAt: d.startedAt, endedAt: d.endedAt, reason: d.reason,
        planned: !!DOWNTIME_REASONS.find((r) => r.code === d.reason)?.planned,
      }));
    // Measure only up to the end of the window: last month's report must not
    // keep counting a stoppage that was still open on its last day up to today.
    const dt = splitDowntime(dtRows, windowEnd < now ? windowEnd : now);

    const row: MachineReportRow = {
      resourceId: m.id, name: m.name,
      workCentre: { id: wc.id, name: wc.name, code: wc.code },
      usage, firm: isFirm(usage), available,
      utilisation: utilisation(usage.hours, available),
      downtime: {
        plannedMinutes: dt.plannedMinutes, unplannedMinutes: dt.unplannedMinutes,
        reasons: paretoByReason(DOWNTIME_REASONS, dt.happened, (r) => r.reason, (r) => r.minutes),
      },
    };

    if (includeCost) {
      const labourRate = Number(wc.labourRate) || 0;
      const overheadRate = Number(wc.overheadRate) || 0;
      const a = m.fixedAssetId ? assetById.get(m.fixedAssetId) : undefined;
      row.cost = {
        labourRate, overheadRate,
        runningCost: runningCost(usage.hours, labourRate, overheadRate),
        asset: a
          ? {
              id: a.id, name: a.name,
              depreciation: depreciationInWindow(toTerms(a), from, to),
              netBookValue: netBookValueAsAt(toTerms(a), to),
            }
          : null,
      };
    }
    rows.push(row);
  }
  return { from, to, machines: rows, unlinked };
}
