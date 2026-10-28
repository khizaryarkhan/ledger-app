/**
 * Production downtime (0115): a work centre and/or MO not producing between
 * two instants, with a fixed DOWNTIME_REASONS code. Records time only — no
 * stock, cost or ledger line moves.
 */

import { db } from "@/db";
import { productionDowntime, manufacturingOrders, workCentres } from "@/db/schema";
import { and, eq, desc, gte, lte } from "drizzle-orm";
import { LedgerValidationError } from "@/lib/ledger";
import { isReason, DOWNTIME_REASONS } from "@/lib/inventory/production-performance";

const err = (m: string): never => { throw new LedgerValidationError(m); };

function instant(v: unknown, label: string): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  if (!Number.isFinite(d.getTime())) err(`${label} is not a valid date and time.`);
  return d;
}

async function checkRefs(orgId: string, moId: string | null, workCentreId: string | null) {
  if (moId) {
    const [m] = await db.select({ id: manufacturingOrders.id }).from(manufacturingOrders).where(and(eq(manufacturingOrders.id, moId), eq(manufacturingOrders.orgId, orgId))).limit(1);
    if (!m) err("Manufacturing order not found.");
  }
  if (workCentreId) {
    const [w] = await db.select({ id: workCentres.id }).from(workCentres).where(and(eq(workCentres.id, workCentreId), eq(workCentres.orgId, orgId))).limit(1);
    if (!w) err("Work centre not found.");
  }
}

export type DowntimeInput = { moId?: string | null; workCentreId?: string | null; startedAt?: string; endedAt?: string | null; reason?: string; notes?: string | null };

export async function listDowntime(orgId: string, f: { moId?: string | null; from?: Date | null; to?: Date | null } = {}) {
  const conds = [eq(productionDowntime.orgId, orgId)];
  if (f.moId) conds.push(eq(productionDowntime.moId, f.moId));
  if (f.from) conds.push(gte(productionDowntime.startedAt, f.from));
  if (f.to) conds.push(lte(productionDowntime.startedAt, f.to));
  return db.select().from(productionDowntime).where(and(...conds)).orderBy(desc(productionDowntime.startedAt)).limit(500);
}

export async function createDowntime(orgId: string, b: DowntimeInput, actorId: string | null) {
  const moId = b.moId ? String(b.moId) : null;
  const workCentreId = b.workCentreId ? String(b.workCentreId) : null;
  if (!moId && !workCentreId) err("Say which work centre or order was stopped.");
  if (!isReason(DOWNTIME_REASONS, b.reason)) err("Choose a downtime reason.");
  const startedAt = instant(b.startedAt, "Start") ?? err("Enter when the stoppage started.");
  const endedAt = instant(b.endedAt, "End");
  if (endedAt && endedAt < startedAt) err("A stoppage can't end before it started.");
  await checkRefs(orgId, moId, workCentreId);
  const [row] = await db.insert(productionDowntime).values({
    orgId, moId, workCentreId, startedAt, endedAt, reason: b.reason!, notes: b.notes ? String(b.notes).trim().slice(0, 2000) || null : null, createdBy: actorId,
  }).returning();
  return row;
}

export async function updateDowntime(orgId: string, id: string, b: DowntimeInput) {
  const [cur] = await db.select().from(productionDowntime).where(and(eq(productionDowntime.id, id), eq(productionDowntime.orgId, orgId))).limit(1);
  if (!cur) err("Downtime record not found.");
  const set: Partial<typeof productionDowntime.$inferInsert> = {};
  if (b.reason !== undefined) { if (!isReason(DOWNTIME_REASONS, b.reason)) err("Unknown downtime reason."); set.reason = b.reason; }
  if (b.startedAt !== undefined) set.startedAt = instant(b.startedAt, "Start") ?? err("Enter when the stoppage started.");
  if (b.endedAt !== undefined) set.endedAt = instant(b.endedAt, "End");
  if (b.notes !== undefined) set.notes = b.notes ? String(b.notes).trim().slice(0, 2000) || null : null;
  const start = set.startedAt ?? cur!.startedAt;
  const end = set.endedAt !== undefined ? set.endedAt : cur!.endedAt;
  if (end && end < start) err("A stoppage can't end before it started.");
  await db.update(productionDowntime).set(set).where(and(eq(productionDowntime.id, id), eq(productionDowntime.orgId, orgId)));
  return { id, updated: true };
}

export async function deleteDowntime(orgId: string, id: string) {
  await db.delete(productionDowntime).where(and(eq(productionDowntime.id, id), eq(productionDowntime.orgId, orgId)));
  return { id, deleted: true };
}
