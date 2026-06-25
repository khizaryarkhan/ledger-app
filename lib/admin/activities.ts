import { db } from "@/db";
import { crmActivities, landingPageRequests, organisations, opportunities } from "@/db/schema";
import { eq } from "drizzle-orm";

export type ActivityType =
  | "email_sent" | "email_received" | "call_logged" | "note_added"
  | "task_created" | "task_completed" | "status_changed"
  | "sequence_enrolled" | "sequence_sent" | "sequence_stopped"
  | "deal_created" | "deal_moved" | "deal_won" | "deal_lost"
  | "invoice_issued" | "payment_received"
  | "account_created" | "owner_assigned" | "customer_activated";

export interface LogActivityInput {
  type: ActivityType;
  title: string;
  body?: string | null;
  meta?: Record<string, any> | null;
  accountId?: string | null;
  leadId?: string | null;
  orgId?: string | null;
  opportunityId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  occurredAt?: Date;
}

/**
 * Append one event to the CRM activity timeline. Best-effort: it resolves the
 * owning account from whatever link it's given (lead → org → opportunity) and
 * NEVER throws — a logging failure must never break the action that triggered it.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    let accountId = input.accountId ?? null;
    if (!accountId && input.leadId) {
      const [l] = await db.select({ a: landingPageRequests.accountId }).from(landingPageRequests).where(eq(landingPageRequests.id, input.leadId)).limit(1);
      accountId = l?.a ?? null;
    }
    if (!accountId && input.orgId) {
      const [o] = await db.select({ a: organisations.accountId }).from(organisations).where(eq(organisations.id, input.orgId)).limit(1);
      accountId = o?.a ?? null;
    }
    if (!accountId && input.opportunityId) {
      const [op] = await db.select({ a: opportunities.accountId }).from(opportunities).where(eq(opportunities.id, input.opportunityId)).limit(1);
      accountId = op?.a ?? null;
    }

    await db.insert(crmActivities).values({
      type:          input.type,
      title:         input.title.slice(0, 300),
      body:          input.body ?? null,
      meta:          input.meta ?? null,
      accountId,
      leadId:        input.leadId ?? null,
      orgId:         input.orgId ?? null,
      opportunityId: input.opportunityId ?? null,
      actorId:       input.actorId ?? null,
      actorName:     input.actorName ?? null,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    });
  } catch {
    /* activity logging is best-effort — never break the caller */
  }
}
