/**
 * Track & Trace — append-only audit event log.
 * logEvent() is always wrapped in try/catch so logging NEVER breaks primary actions.
 */
import { db } from "@/db";
import { auditEvents } from "@/db/schema";

export type EventType =
  | "email_sent"       // automated reminder email dispatched
  | "email_manual"     // manually composed email sent
  | "note_added"       // internal note added
  | "stage_changed"    // collection stage changed on invoice
  | "payment_recorded" // payment (full or partial) posted
  | "promise_to_pay"   // promise-to-pay date set/updated
  | "dispute_raised"   // dispute reason set
  | "programme_toggled"   // auto-reminder programme on/off
  | "chase_mode_changed"  // customer chase level changed (customer ↔ project)
  | "invoice_synced"   // QBO sync created/updated this invoice
  | "contact_updated"; // contact details changed

export interface LogEventArgs {
  orgId: string;
  eventType: EventType;
  customerId?: string | null;
  projectId?: string | null;
  invoiceId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  meta?: Record<string, unknown>;
}

export async function logEvent(args: LogEventArgs): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      orgId:      args.orgId,
      eventType:  args.eventType,
      customerId: args.customerId  ?? null,
      projectId:  args.projectId  ?? null,
      invoiceId:  args.invoiceId  ?? null,
      actorId:    args.actorId    ?? null,
      actorName:  args.actorName  ?? null,
      meta:       (args.meta      ?? {}) as any,
      occurredAt: new Date(),
    });
  } catch (e) {
    // Logging must never break the primary action
    console.error("[audit] logEvent failed:", e);
  }
}
