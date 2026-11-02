/**
 * The db half of machine linking and usage.
 *
 * Every query takes orgId first. A link is validated against the caller's own
 * organisation before it is stored: a foreign key proves a row EXISTS, not
 * whose it is, and a machine pointing at another tenant's work centre would
 * read that tenant's production hours.
 */

import { db } from "@/db";
import { resources, workCentres, fixedAssets, productionRuns, moOperations } from "@/db/schema";
import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import {
  usageForWorkCentre, isFirm,
  type CompletionRun, type MachineUsage, type RunHours,
} from "./machine";

export type LinkOutcome =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * May this machine be linked to these records?
 *
 * Checked: each exists in THIS organisation, and neither is already another
 * machine's. The unique indexes are the real guard against two concurrent
 * saves; this exists so the person sees which machine already has it instead of
 * a constraint error.
 */
export async function checkMachineLinks(
  orgId: string,
  links: { workCentreId?: string | null; fixedAssetId?: string | null },
  selfId?: string,
): Promise<LinkOutcome> {
  if (links.workCentreId) {
    const [wc] = await db.select({ id: workCentres.id }).from(workCentres)
      .where(and(eq(workCentres.id, links.workCentreId), eq(workCentres.orgId, orgId))).limit(1);
    if (!wc) return { ok: false, error: "Work centre not found", status: 404 };
    const [clash] = await db.select({ name: resources.name }).from(resources)
      .where(and(eq(resources.orgId, orgId), eq(resources.workCentreId, links.workCentreId), selfId ? ne(resources.id, selfId) : undefined)).limit(1);
    if (clash) return { ok: false, error: `That work centre is already linked to ${clash.name}`, status: 409 };
  }
  if (links.fixedAssetId) {
    const [fa] = await db.select({ id: fixedAssets.id }).from(fixedAssets)
      .where(and(eq(fixedAssets.id, links.fixedAssetId), eq(fixedAssets.orgId, orgId))).limit(1);
    if (!fa) return { ok: false, error: "Fixed asset not found", status: 404 };
    const [clash] = await db.select({ name: resources.name }).from(resources)
      .where(and(eq(resources.orgId, orgId), eq(resources.fixedAssetId, links.fixedAssetId), selfId ? ne(resources.id, selfId) : undefined)).limit(1);
    if (clash) return { ok: false, error: `That fixed asset is already linked to ${clash.name}`, status: 409 };
  }
  return { ok: true };
}

/** Postgres unique_violation, as thrown by neon-http for the two link indexes. */
export function isLinkRace(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return err?.code === "23505" && /resources_org_(work_centre|fixed_asset)_unique/.test(err.message ?? "");
}

export type MachineUsageResult =
  | { linked: false }
  | {
      linked: true;
      workCentre: { id: string; name: string; code: string | null };
      from: string;
      to: string;
      usage: MachineUsage;
      /** True only when every hour was typed by a person. */
      firm: boolean;
    };

/**
 * Hours this machine was used in [from, to], read from completion runs.
 * `{ linked: false }` for a machine with no work centre: there is nothing to
 * derive from, which is different from "used for zero hours".
 */
export async function loadMachineUsage(
  orgId: string, resourceId: string, from: string, to: string,
): Promise<MachineUsageResult> {
  const [res] = await db.select({ workCentreId: resources.workCentreId }).from(resources)
    .where(and(eq(resources.id, resourceId), eq(resources.orgId, orgId), eq(resources.type, "equipment"))).limit(1);
  if (!res?.workCentreId) return { linked: false };

  const [wc] = await db.select({ id: workCentres.id, name: workCentres.name, code: workCentres.code }).from(workCentres)
    .where(and(eq(workCentres.id, res.workCentreId), eq(workCentres.orgId, orgId))).limit(1);
  if (!wc) return { linked: false };

  const runRows = await db.select({
    id: productionRuns.id, producedDate: productionRuns.producedDate,
    moId: productionRuns.moId, operationHours: productionRuns.operationHours,
  }).from(productionRuns).where(and(
    eq(productionRuns.orgId, orgId), eq(productionRuns.status, "Completed"),
    gte(productionRuns.producedDate, from), lte(productionRuns.producedDate, to),
  ));
  const moRuns = runRows.filter((r) => r.moId);

  const moIds = Array.from(new Set(moRuns.map((r) => r.moId as string)));
  const ops = moIds.length
    ? await db.select({ id: moOperations.id, workCentreId: moOperations.workCentreId }).from(moOperations)
        .where(and(eq(moOperations.orgId, orgId), inArray(moOperations.moId, moIds)))
    : [];
  const operationWorkCentre = new Map<string, string | null>(ops.map((o) => [o.id, o.workCentreId ?? null]));

  const runs: CompletionRun[] = moRuns.map((r) => ({
    runId: r.id, producedDate: r.producedDate ?? null, moId: r.moId ?? null,
    // The column is untyped jsonb written by mo-completion; anything that is not
    // an array of {operationId, hours} contributes nothing rather than throwing.
    operationHours: Array.isArray(r.operationHours) ? (r.operationHours as RunHours[]) : [],
  }));

  const usage = usageForWorkCentre(wc.id, runs, operationWorkCentre, from, to);
  return { linked: true, workCentre: wc, from, to, usage, firm: isFirm(usage) };
}
