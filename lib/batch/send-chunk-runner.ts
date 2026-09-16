/**
 * Chunked, resumable bulk invoice sender.
 *
 * The same lease/cursor engine as the import and delete runners
 * (lib/batch/lease.ts): each invocation sends a bounded slice, and EVERY email
 * is durably recorded — recipient, reference, message id or error — before the
 * next one starts. A crash mid-run loses at most the one in-flight email from
 * the log, never the truth of what has already gone out.
 *
 * That matters more here than for an import. An email cannot be un-sent, and
 * the old design (a `for` loop inside the React modal) could stop at any point
 * — a closed tab, a slept laptop, a dropped connection — with an unknown number
 * of customers already emailed and NOTHING written down about which. Exactly
 * the failure CLAUDE.md records for the old delete path.
 */

import { db } from "@/db";
import { batchJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { claimChunk, finishChunkCall, releaseLeaseOnError, runChunkLoop, type ChunkOutcome } from "./lease";
import { sendGroupEmail, type SendJobGroup, type SendJobOptions } from "@/lib/bulk-send";

/** Pause between emails. Gmail and Microsoft both throttle per-second bursts,
 *  and a 200+ email run is exactly the shape that trips them. The chunk loop's
 *  own 45s time budget then yields back to the Inngest event chain, so a slow
 *  pace costs wall-clock, never durability. */
const SEND_SPACING_MS = 400;

export async function processSendChunk(orgId: string, jobId: string): Promise<ChunkOutcome> {
  let cursor = 0;
  let claimed = false;
  let totalRowsForError = 0;
  try {
    const [job] = await db.select().from(batchJobs)
      .where(and(eq(batchJobs.id, jobId), eq(batchJobs.orgId, orgId))).limit(1);
    if (!job) return { accepted: false, processedCount: 0, totalRows: 0, done: false, error: "Job not found" };
    if (job.status === "done") return { accepted: false, processedCount: job.processedCount ?? 0, totalRows: job.totalRows, done: true, status: "done" };

    cursor = job.processedCount ?? 0;
    totalRowsForError = job.totalRows;

    const claim = await claimChunk(jobId, cursor);
    if (!claim.claimed) {
      return { accepted: false, processedCount: claim.processedCount, totalRows: claim.totalRows, done: claim.status === "done", status: claim.status ?? undefined, busy: claim.busy };
    }
    claimed = true;

    const input = (job.input ?? {}) as { groups?: SendJobGroup[]; options?: SendJobOptions };
    const groups = input.groups ?? [];
    const options = input.options;
    if (!options || !groups.length) {
      await finishChunkCall(jobId, true);
      return { accepted: true, processedCount: groups.length, totalRows: job.totalRows, done: true };
    }

    const { processedTo } = await runChunkLoop(jobId, cursor, groups.length, async (i) => {
      const g = groups[i];
      if (i > cursor) await new Promise(r => setTimeout(r, SEND_SPACING_MS));
      const res = await sendGroupEmail(orgId, g, options);
      // What is recorded is what a human needs to answer "did this customer get
      // their email?" months later — not just a boolean.
      return {
        ok: res.ok,
        // `row` and `key` are what Job History's failed-row table renders —
        // without them an email failure shows a blank line with no clue which
        // customer it was.
        row: i + 1,
        key: g.label,
        customer: g.label,
        to: g.to,
        invoices: g.rows.length,
        ref: res.ref,
        messageId: res.messageId,
        error: res.error,
      };
    });

    const done = processedTo >= groups.length;
    await finishChunkCall(jobId, done);
    return { accepted: true, processedCount: processedTo, totalRows: job.totalRows, done };
  } catch (e: any) {
    if (claimed) await releaseLeaseOnError(jobId).catch(() => {});
    return { accepted: false, processedCount: cursor, totalRows: totalRowsForError, done: false, error: e?.message || "Send chunk failed" };
  }
}
