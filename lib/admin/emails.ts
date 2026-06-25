import { db } from "@/db";
import { crmEmails, landingPageRequests, organisations } from "@/db/schema";
import { eq, and } from "drizzle-orm";

// Normalize a subject into a stable thread key: strip Re:/Fwd:/Fw: prefixes,
// collapse whitespace, lowercase. Groups a back-and-forth into one conversation.
export function threadKeyFor(subject?: string | null): string {
  const s = (subject || "(no subject)").trim();
  return s.replace(/^((re|fwd?|aw|sv)\s*:\s*)+/i, "").replace(/\s+/g, " ").toLowerCase().slice(0, 255) || "(no subject)";
}

const snippetOf = (html?: string | null, text?: string | null): string => {
  const raw = (text || "").trim() || (html || "").replace(/<[^>]+>/g, " ");
  return raw.replace(/\s+/g, " ").trim().slice(0, 400);
};

export interface RecordEmailInput {
  direction: "outbound" | "inbound";
  fromAddr: string;
  toAddr: string;
  subject?: string | null;
  cc?: string | null;
  bodyHtml?: string | null;
  bodyText?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  accountId?: string | null;
  leadId?: string | null;
  orgId?: string | null;
  mailboxUserId?: string | null;
  occurredAt?: Date;
}

/**
 * Persist one email to the durable CRM store, threaded + linked to its account.
 * Best-effort (never throws). Dedups inbound by messageId so re-syncs are safe.
 * Returns the resolved accountId (or null) so callers can chain follow-ups.
 */
export async function recordEmail(input: RecordEmailInput): Promise<string | null> {
  try {
    // Dedup by Message-ID (mainly for inbound re-sync).
    if (input.messageId) {
      const [dupe] = await db.select({ id: crmEmails.id }).from(crmEmails).where(eq(crmEmails.messageId, input.messageId)).limit(1);
      if (dupe) return null;
    }

    let accountId = input.accountId ?? null;
    if (!accountId && input.leadId) {
      const [l] = await db.select({ a: landingPageRequests.accountId }).from(landingPageRequests).where(eq(landingPageRequests.id, input.leadId)).limit(1);
      accountId = l?.a ?? null;
    }
    if (!accountId && input.orgId) {
      const [o] = await db.select({ a: organisations.accountId }).from(organisations).where(eq(organisations.id, input.orgId)).limit(1);
      accountId = o?.a ?? null;
    }

    await db.insert(crmEmails).values({
      direction:     input.direction,
      threadKey:     threadKeyFor(input.subject),
      messageId:     input.messageId ?? null,
      inReplyTo:     input.inReplyTo ?? null,
      fromAddr:      input.fromAddr.slice(0, 320),
      toAddr:        input.toAddr,
      cc:            input.cc ?? null,
      subject:       input.subject?.slice(0, 500) ?? null,
      snippet:       snippetOf(input.bodyHtml, input.bodyText) || null,
      bodyHtml:      input.bodyHtml ?? null,
      bodyText:      input.bodyText ?? null,
      accountId, leadId: input.leadId ?? null, orgId: input.orgId ?? null,
      mailboxUserId: input.mailboxUserId ?? null,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    });
    return accountId;
  } catch {
    return null; // durable email logging is best-effort
  }
}

/** Resolve the lead (and its account) that an inbound from-address belongs to. */
export async function findLeadByEmail(fromAddr: string): Promise<{ leadId: string; accountId: string | null } | null> {
  const addr = (fromAddr || "").trim().toLowerCase();
  if (!addr) return null;
  const [l] = await db.select({ id: landingPageRequests.id, accountId: landingPageRequests.accountId })
    .from(landingPageRequests).where(eq(landingPageRequests.email, addr)).limit(1);
  return l ? { leadId: l.id, accountId: l.accountId } : null;
}
