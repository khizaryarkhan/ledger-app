/**
 * POST /api/invoices/batch-update
 *
 * Updates multiple invoices in one bulk UPDATE (atomic as a single statement;
 * neon-http has no multi-statement transactions). StageChange communication
 * records are inserted in a follow-up statement wrapped in try/catch — a
 * failure there never rolls back the stage updates.
 *
 * Body: {
 *   ids:   string[]          // invoice UUIDs — must all belong to this org
 *   patch: {
 *     collectionStage?:    string
 *     escalatedToUserId?:  string | null
 *     escalatedToName?:    string | null
 *     escalatedToEmail?:   string | null
 *     escalationType?:     string | null
 *     escalationNote?:     string | null
 *     promiseDate?:        string | null   // set when bulk-moving to the "Committed" stage
 *   }
 * }
 */

import { db } from "@/db";
import { invoices, communications, invoicePromises } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { logEvent } from "@/lib/audit";

const Schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  patch: z.object({
    collectionStage:   z.string().max(64).optional(),
    escalatedToUserId: z.string().uuid().nullable().optional(),
    escalatedToName:   z.string().max(255).nullable().optional(),
    escalatedToEmail:  z.string().max(255).nullable().optional(),
    escalationType:    z.string().max(64).nullable().optional(),
    escalationNote:    z.string().max(2000).nullable().optional(),
    promiseDate:       z.string().max(32).nullable().optional(),
  }),
});

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await req.json());
  } catch (e: any) {
    return bad(e?.issues?.[0]?.message ?? "Invalid request");
  }

  const { ids, patch } = body;
  const actorId   = (session?.user as any)?.id   ?? null;
  const actorName = (session?.user as any)?.name ?? "Staff";
  const actorRole = (session?.user as any)?.role;
  const staffSource = actorRole === "rep" ? "Rep" : "Accountant";

  // Load all target invoices in one query — confirms org ownership.
  const targets = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId!), inArray(invoices.id, ids)));

  if (targets.length === 0) return bad("No matching invoices found", 404);

  // Build the DB patch — server enforces the Escalated/clear-assignee rule.
  const dbPatch: Record<string, any> = { updatedAt: new Date() };
  if (patch.collectionStage !== undefined) {
    dbPatch.collectionStage = patch.collectionStage;

    if (patch.collectionStage === "Escalated") {
      if (patch.escalatedToUserId !== undefined) dbPatch.escalatedToUserId = patch.escalatedToUserId;
      if (patch.escalatedToName  !== undefined) dbPatch.escalatedToName   = patch.escalatedToName;
      if (patch.escalatedToEmail !== undefined) dbPatch.escalatedToEmail  = patch.escalatedToEmail;
      if (patch.escalationType   !== undefined) dbPatch.escalationType    = patch.escalationType;
      if (patch.escalationNote   !== undefined) dbPatch.escalationNote    = patch.escalationNote;
      dbPatch.escalatedAt = new Date();
    } else {
      // Moving away from Escalated always clears the assignee and context.
      dbPatch.escalatedToUserId = null;
      dbPatch.escalatedToName   = null;
      dbPatch.escalatedToEmail  = null;
      dbPatch.escalationType    = null;
      dbPatch.escalationNote    = null;
      dbPatch.escalatedAt       = null;
    }
  }
  if (patch.promiseDate !== undefined) dbPatch.promiseDate = patch.promiseDate;

  const stageChanging = patch.collectionStage !== undefined;

  // 1. Bulk update all invoices in one SQL statement (atomic across all rows).
  await db
    .update(invoices)
    .set(dbPatch)
    .where(and(eq(invoices.orgId, orgId!), inArray(invoices.id, ids)));

  // 2. Insert StageChange communications for the activity feed.
  //    Wrapped in try/catch — a failure here never rolls back the stage updates.
  if (stageChanging) {
    try {
      const toStage       = patch.collectionStage!;
      const assigneeName  = toStage === "Escalated" ? (patch.escalatedToName  ?? null) : null;
      const assigneeEmail = toStage === "Escalated" ? (patch.escalatedToEmail ?? null) : null;
      const escType       = toStage === "Escalated" ? (patch.escalationType   ?? null) : null;
      const escNote       = toStage === "Escalated" ? (patch.escalationNote   ?? null) : null;
      const promiseDate   = patch.promiseDate ?? null;
      const bodyText      = assigneeName
        ? [`${assigneeName}${assigneeEmail ? ` · ${assigneeEmail}` : ""}`, escNote ? `“${escNote}”` : null]
            .filter(Boolean).join("\n")
        : promiseDate ? `Committed to pay ${promiseDate}` : null;

      const changed = targets.filter(inv => inv.collectionStage !== toStage);
      if (changed.length > 0) {
        await db.insert(communications).values(
          changed.map(inv => ({
            orgId:      orgId!,
            customerId: inv.customerId,
            projectId:  inv.projectId ?? null,
            invoiceId:  inv.id,
            direction:  "Outbound" as const,
            channel:    "StageChange",
            subject:    escType ? `${inv.collectionStage ?? "—"} → ${toStage} · ${escType}` : `${inv.collectionStage ?? "—"} → ${toStage}`,
            body:       bodyText,
            sender:     actorName,
            matchedBy:  "System",
            isDraft:    false,
            ...(actorId ? { authorId: actorId } : {}),
          }))
        );
      }
    } catch (e) {
      console.error("[batch-update] Failed to log StageChange comms:", e);
    }
  }

  // 3. Record each new commitment in invoicePromises — same audit trail the
  //    single-invoice PATCH route writes, so the Responses inbox and invoice
  //    timeline see bulk commitments exactly like individually-entered ones.
  if (patch.promiseDate) {
    try {
      const changedPromise = targets.filter(inv => inv.promiseDate !== patch.promiseDate);
      if (changedPromise.length > 0) {
        await db.insert(invoicePromises).values(
          changedPromise.map(inv => ({
            orgId: orgId!, invoiceId: inv.id, customerId: inv.customerId,
            promiseDate: String(patch.promiseDate).slice(0, 16),
            amount: null, source: staffSource, enteredBy: actorId, status: "Active" as const,
          }))
        );
      }
    } catch (e) {
      console.error("[batch-update] Failed to log invoicePromises:", e);
    }
  }

  // Audit log (outside the transaction — non-critical).
  if (stageChanging) {
    await logEvent({
      orgId:    orgId!,
      eventType: "stage_changed",
      actorId,
      actorName,
      meta: {
        batch:    true,
        count:    targets.length,
        toStage:  patch.collectionStage,
        escalatedToName: patch.escalatedToName ?? null,
      },
    }).catch(() => {});
  }

  return ok({ updated: targets.length });
}
