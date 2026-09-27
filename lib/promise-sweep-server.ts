/**
 * The daily promise sweeps — DB runner.
 *
 * The classification rule itself lives in lib/promise-sweep.ts (pure, no @/db
 * import, unit-testable with no database). This file is the only place
 * allowed to write invoice_promises.status to "Met"/"Broken" —
 * tests/architecture.test.ts guards that.
 *
 * Both callers (inngest/functions/chase.ts's scheduled cron, and the manual
 * app/api/cron/route.ts trigger) go through runPromiseSweeps() so they can
 * never drift apart again — that drift (one copy missing the deleted-invoice
 * filter, the other missing the kept sweep entirely) was the bug this file
 * fixes. See CLAUDE.md's "Promise lifecycle" section for the history.
 */
import { and, eq, inArray, isNull, lt, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { communications, invoicePromises, invoices } from "@/db/schema";
import { today as todayUtc } from "@/lib/format";
import {
  brokenPromiseCommunication,
  keptPromiseCommunication,
  planPromiseSweep,
  type PromiseSweepCandidate,
  type PromiseSweepCommunication,
} from "@/lib/promise-sweep";

export interface PromiseSweepOptions {
  today: string;
  orgId?: string;
}

const CHUNK_SIZE = 100;

/** Active, non-deleted-invoice promises, narrowed further by each sweep's own condition. */
async function selectCandidates(orgId: string | undefined, narrow: SQL | undefined): Promise<PromiseSweepCandidate[]> {
  const rows = await db
    .select({
      id: invoicePromises.id,
      orgId: invoicePromises.orgId,
      invoiceId: invoicePromises.invoiceId,
      customerId: invoicePromises.customerId,
      projectId: invoices.projectId,
      promiseDate: invoicePromises.promiseDate,
      status: invoicePromises.status,
      paymentStatus: invoices.paymentStatus,
      paidAt: invoices.paidAt,
      invoiceDeletedAt: invoices.deletedAt,
    })
    .from(invoicePromises)
    .leftJoin(invoices, eq(invoices.id, invoicePromises.invoiceId))
    .where(and(
      eq(invoicePromises.status, "Active"),
      isNull(invoices.deletedAt),
      narrow,
      orgId ? eq(invoicePromises.orgId, orgId) : undefined,
    ));

  return rows.map(r => ({
    id: r.id,
    orgId: r.orgId,
    invoiceId: r.invoiceId,
    customerId: r.customerId,
    projectId: r.projectId ?? null,
    promiseDate: r.promiseDate,
    status: r.status,
    paymentStatus: r.paymentStatus ?? null,
    paidAt: r.paidAt ?? null,
    invoiceDeletedAt: r.invoiceDeletedAt ?? null,
  }));
}

/**
 * Flips exactly the ids that are STILL "Active" at UPDATE time, in chunks of
 * 100, and returns only the ids this call actually flipped — so a concurrent
 * runner (the Inngest cron and a manual /api/cron hit landing close together)
 * can't double-flip a promise or double-log its communication.
 */
async function flipStatus(ids: string[], status: "Met" | "Broken"): Promise<string[]> {
  const flipped: string[] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const updated = await db
      .update(invoicePromises)
      .set({ status })
      .where(and(inArray(invoicePromises.id, chunk), eq(invoicePromises.status, "Active")))
      .returning({ id: invoicePromises.id });
    flipped.push(...updated.map(u => u.id));
  }
  return flipped;
}

async function logCommunications(rows: PromiseSweepCommunication[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await db.insert(communications).values(rows);
  } catch (err: any) {
    // Non-fatal — the promise was still flipped correctly. But this used to
    // be a swallowed `.catch(() => {})` with no trace at all; a missing
    // activity-log entry should at least be visible in the server logs.
    console.error("lib/promise-sweep-server: failed to log promise communications:", err?.message);
  }
}

/** Close Active promises whose invoice is now paid — regardless of the promise date. */
export async function sweepKeptPromises(opts: PromiseSweepOptions): Promise<{ met: number }> {
  const rows = await selectCandidates(opts.orgId, eq(invoices.paymentStatus, "Paid"));
  const { met } = planPromiseSweep(rows, opts.today);
  if (met.length === 0) return { met: 0 };

  const flippedIds = await flipStatus(met.map(c => c.id), "Met");
  const flippedSet = new Set(flippedIds);
  await logCommunications(met.filter(c => flippedSet.has(c.id)).map(keptPromiseCommunication));
  return { met: flippedIds.length };
}

/** Flip passed, still-unpaid Active promises to "Broken". Must run AFTER sweepKeptPromises. */
export async function sweepBrokenPromises(opts: PromiseSweepOptions): Promise<{ broken: number }> {
  const rows = await selectCandidates(opts.orgId, lt(invoicePromises.promiseDate, opts.today));
  const { broken } = planPromiseSweep(rows, opts.today);
  if (broken.length === 0) return { broken: 0 };

  const flippedIds = await flipStatus(broken.map(c => c.id), "Broken");
  const flippedSet = new Set(flippedIds);
  await logCommunications(broken.filter(c => flippedSet.has(c.id)).map(brokenPromiseCommunication));
  return { broken: flippedIds.length };
}

/**
 * Runs both sweeps in the correct order — kept BEFORE broken, so an invoice
 * paid on or after its promise date is recorded as kept, never broken.
 * `today` defaults to lib/format.ts's today() (UTC) when not passed.
 */
export async function runPromiseSweeps(opts: Partial<PromiseSweepOptions> = {}): Promise<{ met: number; broken: number }> {
  const today = opts.today ?? todayUtc();
  const orgId = opts.orgId;
  const { met } = await sweepKeptPromises({ today, orgId });
  const { broken } = await sweepBrokenPromises({ today, orgId });
  return { met, broken };
}
