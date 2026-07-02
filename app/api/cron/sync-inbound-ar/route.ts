/**
 * AR reply capture cron — polls each org's email inbox for replies to AR
 * collection emails and auto-creates inbound Communication records linked to
 * the right invoice/customer.
 *
 * Threading: matches the inbound email's In-Reply-To header against
 * communications.message_id stored when the outbound email was sent.
 *
 * Transports supported:
 *   - Gmail OAuth  (requires gmail.readonly — re-auth orgs when ready)
 *   - SMTP/IMAP    (uses same credentials as the configured SMTP transport)
 *   - Microsoft    (requires Mail.Read — re-auth orgs when ready)
 *
 * GET /api/cron/sync-inbound-ar
 * Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { communications, gmailTokens, orgSmtpSettings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getValidGmailToken } from "@/lib/gmail";
import { decryptSecret } from "@/lib/crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let captured = 0;
  const errors: string[] = [];

  // --- Gmail orgs ---
  const gmailOrgs = await db
    .select({ orgId: gmailTokens.orgId })
    .from(gmailTokens)
    .where(eq(gmailTokens.orgId, gmailTokens.orgId)); // select all rows
  for (const { orgId } of gmailOrgs) {
    if (!orgId) continue;
    try {
      captured += await pollGmailInbox(orgId);
    } catch (e: any) {
      errors.push(`gmail:${orgId}: ${e.message}`);
    }
  }

  // --- SMTP orgs (IMAP with same credentials) ---
  const smtpOrgs = await db.select().from(orgSmtpSettings);
  for (const cfg of smtpOrgs) {
    // Skip orgs already handled by Gmail
    const alreadyGmail = gmailOrgs.some(g => g.orgId === cfg.orgId);
    if (alreadyGmail) continue;
    try {
      captured += await pollSmtpImap(cfg);
    } catch (e: any) {
      // IMAP connection failures are expected when SMTP-only or host doesn't support IMAP.
      console.warn(`[sync-inbound-ar] SMTP IMAP skip for org ${cfg.orgId}: ${e.message}`);
    }
  }

  // Microsoft orgs: TODO after Mail.Read re-auth

  return NextResponse.json({ ok: true, captured, errors: errors.length ? errors : undefined });
}

// ---------------------------------------------------------------------------
// Gmail inbox poll
// ---------------------------------------------------------------------------
async function pollGmailInbox(orgId: string): Promise<number> {
  const token = await getValidGmailToken(orgId);
  if (!token) return 0;

  // Load outbound messageIds for this org to match against
  const knownSet = await getOutboundMessageIds(orgId);
  if (!knownSet.size) return 0;

  // List recent INBOX messages. 403 = missing gmail.readonly scope → skip silently.
  const listRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=50",
    { headers: { Authorization: `Bearer ${token.accessToken}` } },
  );
  if (!listRes.ok) {
    if (listRes.status === 403) return 0; // scope not yet granted
    const err = await listRes.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Gmail list failed (${listRes.status})`);
  }
  const listData = await listRes.json();
  const gmailIds: string[] = (listData.messages || []).map((m: any) => m.id);

  let captured = 0;
  for (const gmailMsgId of gmailIds) {
    try {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMsgId}` +
          `?format=metadata&metadataHeaders=Message-ID&metadataHeaders=In-Reply-To` +
          `&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } },
      );
      if (!msgRes.ok) continue;
      const msg = await msgRes.json();

      const headers: Record<string, string> = {};
      for (const h of (msg.payload?.headers ?? [])) {
        headers[(h.name as string).toLowerCase()] = h.value as string;
      }

      const inReplyTo = headers["in-reply-to"];
      if (!inReplyTo || !knownSet.has(inReplyTo)) continue;

      const rfcMessageId = headers["message-id"] ?? null;
      captured += await createInboundIfNew(orgId, rfcMessageId, inReplyTo, {
        subject: headers["subject"] ?? "",
        from:    headers["from"] ?? "",
        sentAt:  headers["date"] ? new Date(headers["date"]) : new Date(),
        body:    "",
      });
    } catch {}
  }
  return captured;
}

// ---------------------------------------------------------------------------
// SMTP/IMAP poll
// ---------------------------------------------------------------------------
async function pollSmtpImap(cfg: typeof orgSmtpSettings.$inferSelect): Promise<number> {
  const pass = decryptSecret(cfg.pass);
  if (!cfg.host || !cfg.user || !pass) return 0;

  const knownSet = await getOutboundMessageIds(cfg.orgId);
  if (!knownSet.size) return 0;

  // Derive IMAP host: smtp.X → imap.X, otherwise try same host.
  const imapHost = cfg.host.replace(/^smtp\./, "imap.");

  const client = new ImapFlow({
    host:          imapHost,
    port:          993,
    secure:        true,
    auth:          { user: cfg.user, pass },
    logger:        false,
    socketTimeout: 15_000,
  } as any);

  let captured = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const status: any = client.mailbox;
      const total = (status?.exists as number) ?? 0;
      if (total === 0) return 0;
      const start = Math.max(1, total - 60 + 1);

      for await (const msg of client.fetch(`${start}:*`, { source: true })) {
        try {
          const parsed = await simpleParser(msg.source as Buffer);
          const inReplyTo = parsed.inReplyTo;
          if (!inReplyTo || !knownSet.has(inReplyTo)) continue;
          captured += await createInboundIfNew(cfg.orgId, parsed.messageId ?? null, inReplyTo, {
            subject: parsed.subject ?? "",
            from:    parsed.from?.text ?? "",
            sentAt:  parsed.date ?? new Date(),
            body:    parsed.text ?? parsed.html ?? "",
          });
        } catch {}
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return captured;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
async function getOutboundMessageIds(orgId: string): Promise<Set<string>> {
  const rows = await db
    .select({ messageId: communications.messageId })
    .from(communications)
    .where(and(
      eq(communications.orgId, orgId),
      eq(communications.direction, "Outbound"),
    ));
  return new Set(rows.map(r => r.messageId).filter((id): id is string => !!id));
}

async function createInboundIfNew(
  orgId: string,
  rfcMessageId: string | null,
  inReplyTo: string,
  meta: { subject: string; from: string; sentAt: Date; body: string },
): Promise<number> {
  // Dedup: if we already stored this messageId, skip.
  if (rfcMessageId) {
    const [existing] = await db
      .select({ id: communications.id })
      .from(communications)
      .where(and(
        eq(communications.orgId, orgId),
        eq(communications.messageId, rfcMessageId),
      ))
      .limit(1);
    if (existing) return 0;
  }

  // Look up the original outbound communication by its messageId.
  const [original] = await db
    .select({
      invoiceId:  communications.invoiceId,
      customerId: communications.customerId,
      projectId:  communications.projectId,
      contactId:  communications.contactId,
    })
    .from(communications)
    .where(and(
      eq(communications.orgId, orgId),
      eq(communications.messageId, inReplyTo),
    ))
    .limit(1);
  if (!original) return 0;

  await db.insert(communications).values({
    orgId,
    customerId: original.customerId,
    projectId:  original.projectId ?? null,
    invoiceId:  original.invoiceId ?? null,
    contactId:  original.contactId ?? null,
    direction:  "Inbound",
    channel:    "Email",
    subject:    meta.subject,
    sender:     meta.from,
    body:       meta.body,
    messageId:  rfcMessageId,
    inReplyTo,
    matchedBy:  "thread",
    sentAt:     meta.sentAt,
  });
  return 1;
}
