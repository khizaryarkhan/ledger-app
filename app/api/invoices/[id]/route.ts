import { db } from "@/db";
import { invoices, invoicePromises, invoiceDisputes, communications } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and } from "drizzle-orm";
import { logEvent } from "@/lib/audit";
import { recomputeInvoiceState } from "@/lib/portal";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!))).limit(1);
  if (!inv) return bad("Not found", 404);
  return ok(inv);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  // Fetch before-state for change detection
  const [before] = await db.select().from(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!))).limit(1);
  if (!before) return bad("Not found", 404);

  const body = await req.json();

  // When moving away from Escalated, always clear the assignee — even if client
  // forgot to send the null fields (server-side safety net).
  if (body.collectionStage && body.collectionStage !== "Escalated" && before.collectionStage === "Escalated") {
    body.escalatedToUserId  = null;
    body.escalatedToName    = null;
    body.escalatedToEmail   = null;
  }

  const [updated] = await db.update(invoices)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!)))
    .returning();
  if (!updated) return bad("Not found", 404);

  const actorId   = (session?.user as any)?.id   ?? null;
  const actorName = (session?.user as any)?.name  ?? null;
  const base = {
    orgId: orgId!,
    customerId: updated.customerId,
    projectId:  updated.projectId ?? null,
    invoiceId:  updated.id,
    actorId,
    actorName,
  };

  // ── Stage changed ──────────────────────────────────────────────────────────
  if (body.collectionStage && body.collectionStage !== before.collectionStage) {
    const toStage   = body.collectionStage as string;
    const fromStage = before.collectionStage ?? "—";
    const assigneeName  = toStage === "Escalated" ? (body.escalatedToName  ?? updated.escalatedToName  ?? null) : null;
    const assigneeEmail = toStage === "Escalated" ? (body.escalatedToEmail ?? updated.escalatedToEmail ?? null) : null;

    await logEvent({
      ...base,
      eventType: "stage_changed",
      meta: { fromStage, toStage, invoiceNo: updated.invoiceNumber, escalatedToName: assigneeName, escalatedToEmail: assigneeEmail },
    });

    // Write a StageChange communication so it surfaces in the activity feed.
    await db.insert(communications).values({
      orgId:      orgId!,
      customerId: updated.customerId,
      projectId:  updated.projectId ?? null,
      invoiceId:  updated.id,
      direction:  "Outbound",
      channel:    "StageChange",
      subject:    `${fromStage} → ${toStage}`,
      // body encodes the assignee for Escalated events; null otherwise.
      body:       assigneeName
                    ? `${assigneeName}${assigneeEmail ? ` · ${assigneeEmail}` : ""}`
                    : null,
      sender:     actorName,
      matchedBy:  "System",
      isDraft:    false,
      authorId:   actorId,
    });
  }

  // ── Promise to pay ─────────────────────────────────────────────────────────
  if (body.promiseDate && body.promiseDate !== before.promiseDate) {
    await logEvent({
      ...base,
      eventType: "promise_to_pay",
      meta: {
        promiseDate: body.promiseDate,
        invoiceNo:   updated.invoiceNumber,
      },
    });
  }

  // ── Dispute raised / updated ───────────────────────────────────────────────
  if (body.disputeReason && body.disputeReason !== before.disputeReason) {
    await logEvent({
      ...base,
      eventType: "dispute_raised",
      meta: {
        reason:    body.disputeReason,
        invoiceNo: updated.invoiceNumber,
      },
    });
  }

  // ── Unify with the Customer Response system ─────────────────────────────────
  // When staff log a promise/dispute via the board or invoice modals, also
  // create the corresponding EVENT so it appears in the Responses inbox and the
  // invoice timeline — and recompute derived state (board stage, auto-pause).
  // This makes the event tables the single source of truth (no duplication).
  const staffSource = role === "rep" ? "Rep" : "Accountant";
  let touchedEvents = false;

  if (body.promiseDate && body.promiseDate !== before.promiseDate) {
    await db.insert(invoicePromises).values({
      orgId: orgId!, invoiceId: updated.id, customerId: updated.customerId,
      promiseDate: String(body.promiseDate).slice(0, 16),
      amount: null, source: staffSource, enteredBy: actorId, status: "Active",
    });
    touchedEvents = true;
  }

  if (body.disputeReason && body.disputeReason !== before.disputeReason) {
    await db.insert(invoiceDisputes).values({
      orgId: orgId!, invoiceId: updated.id, customerId: updated.customerId,
      category: "Other", reason: body.disputeReason,
      source: staffSource, raisedBy: actorId,
      assignedTo: updated.collectionOwnerId ?? actorId,
      status: "Open",
    });
    touchedEvents = true;
  }

  if (touchedEvents) {
    await recomputeInvoiceState(orgId!, updated.id).catch(() => {});
  }

  return ok(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  await db.delete(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!)));
  return ok({ ok: true });
}
