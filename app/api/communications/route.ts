import { db } from "@/db";
import { communications, invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { z } from "zod";
import { desc, eq, and } from "drizzle-orm";
import { logEvent } from "@/lib/audit";

const Schema = z.object({
  customerId: z.string().uuid(),
  invoiceId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  direction: z.enum(["Inbound", "Outbound"]),
  channel: z.enum(["Email", "Note", "Phone", "Meeting"]),
  subject: z.string().optional(),
  sender: z.string().optional(),
  recipients: z.string().optional(),
  body: z.string().optional(),
  matchedBy: z.string().optional(),
  isDraft: z.boolean().default(false),
  refNumber: z.string().optional(),
  stageAtSend: z.string().optional(),
  projectId: z.string().uuid().nullable().optional(),
});

// Stages that should never be auto-overridden (manual-only)
const MANUAL_STAGES = new Set(["Disputed", "Promised", "Promise to Pay", "On Hold", "Escalated"]);

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const invoiceId = searchParams.get("invoiceId");

  let query = db.select().from(communications).where(eq(communications.orgId, orgId!)).$dynamic();
  if (invoiceId) query = query.where(eq(communications.invoiceId, invoiceId));
  else if (customerId) query = query.where(eq(communications.customerId, customerId));

  return ok(await query.orderBy(desc(communications.sentAt)));
}

export async function POST(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  try {
    const data = Schema.parse(await req.json());

    // If this is an outbound email for an invoice, count previous emails to determine auto-stage
    let autoStage: string | null = null;
    let currentStageForLog: string | null = null;

    if (data.invoiceId && !data.isDraft && data.channel === "Email" && data.direction === "Outbound") {
      const [inv] = await db.select().from(invoices).where(eq(invoices.id, data.invoiceId)).limit(1);
      if (inv) {
        currentStageForLog = inv.collectionStage;

        if (!MANUAL_STAGES.has(inv.collectionStage)) {
          // Count previous outbound emails for this invoice (before this one)
          const prevEmails = await db
            .select({ id: communications.id })
            .from(communications)
            .where(and(
              eq(communications.invoiceId, data.invoiceId),
              eq(communications.channel, "Email"),
              eq(communications.direction, "Outbound"),
              eq(communications.isDraft, false),
              eq(communications.orgId, orgId!),
            ));

          const prevCount = prevEmails.length; // 0 = this is 1st email, 1 = 2nd, 2 = 3rd+
          if (prevCount === 0) autoStage = "Reminder Sent";
          else if (prevCount === 1) autoStage = "Second Notice";
          else autoStage = "Final Notice";
        }
      }
    }

    const [created] = await db.insert(communications).values({
      orgId: orgId!,
      customerId: data.customerId,
      projectId: data.projectId ?? null,
      invoiceId: data.invoiceId ?? null,
      contactId: data.contactId ?? null,
      direction: data.direction,
      channel: data.channel,
      subject: data.subject,
      sender: data.sender,
      recipients: data.recipients,
      body: data.body,
      matchedBy: data.matchedBy,
      isDraft: data.isDraft ?? false,
      authorId: (session!.user as any).id,
      refNumber: data.refNumber ?? null,
      stageAtSend: data.stageAtSend ?? currentStageForLog ?? null,
    }).returning();

    // Apply auto-stage to invoice
    if (autoStage && data.invoiceId) {
      const today = new Date().toISOString().slice(0, 10);
      await db.update(invoices)
        .set({ lastFollowupDate: today, collectionStage: autoStage, updatedAt: new Date() })
        .where(eq(invoices.id, data.invoiceId));
    }

    // ── Audit log ─────────────────────────────────────────────────────────────
    const actorId   = (session?.user as any)?.id   ?? null;
    const actorName = (session?.user as any)?.name ?? null;

    if (data.channel === "Note") {
      await logEvent({
        orgId:      orgId!,
        eventType:  "note_added",
        customerId: data.customerId,
        projectId:  data.projectId ?? null,
        invoiceId:  data.invoiceId ?? null,
        actorId,
        actorName,
        meta: { body: data.body ?? "" },
      });
    } else if (data.channel === "Email" && data.direction === "Outbound" && !data.isDraft) {
      // Determine if this was an auto-sent reminder (subject contains "Reminder") or manual
      const isAuto = !!autoStage;
      await logEvent({
        orgId:      orgId!,
        eventType:  isAuto ? "email_sent" : "email_manual",
        customerId: data.customerId,
        projectId:  data.projectId ?? null,
        invoiceId:  data.invoiceId ?? null,
        actorId,
        actorName,
        meta: {
          subject:    data.subject ?? "",
          to:         data.recipients ?? "",
          from:       data.sender ?? "",
          stageAtSend: data.stageAtSend ?? currentStageForLog ?? "",
          autoStage:  autoStage ?? null,
        },
      });
    }

    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to create communication", 500);
  }
}
