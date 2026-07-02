/**
 * Manual inbox sync — session-authenticated so any logged-in user can
 * trigger an IMAP poll for their org on demand without waiting for the
 * nightly cron.
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { communications, orgSmtpSettings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { decryptSecret } from "@/lib/crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [cfg] = await db
    .select()
    .from(orgSmtpSettings)
    .where(eq(orgSmtpSettings.orgId, orgId!))
    .limit(1);

  if (!cfg) return bad("No SMTP configuration found for this organisation", 404);

  const pass = decryptSecret(cfg.pass);
  if (!cfg.host || !cfg.user || !pass) return bad("Incomplete SMTP configuration", 400);

  // Load outbound messageIds for this org
  const rows = await db
    .select({ messageId: communications.messageId })
    .from(communications)
    .where(and(
      eq(communications.orgId, orgId!),
      eq(communications.direction, "Outbound"),
    ));
  const knownSet = new Set(rows.map(r => r.messageId).filter((id): id is string => !!id));
  if (!knownSet.size) return ok({ captured: 0, message: "No outbound emails with message IDs tracked yet" });

  // Try IMAP hosts in order: smtp.X → imap.X, then bare host
  const imapHosts = Array.from(new Set([
    cfg.host.replace(/^smtp\./i, "imap."),
    cfg.host,
  ]));

  let lastError = "";
  for (const imapHost of imapHosts) {
    try {
      const captured = await pollImap(imapHost, cfg.user, pass, orgId!, knownSet);
      return ok({ captured, imapHost });
    } catch (e: any) {
      lastError = e.message;
      // try next host
    }
  }

  return NextResponse.json(
    { error: `IMAP connection failed (tried ${imapHosts.join(", ")}): ${lastError}` },
    { status: 502 },
  );
}

async function pollImap(
  host: string,
  user: string,
  pass: string,
  orgId: string,
  knownSet: Set<string>,
): Promise<number> {
  const client = new ImapFlow({
    host, port: 993, secure: true,
    auth: { user, pass },
    logger: false,
    socketTimeout: 15_000,
  } as any);

  await client.connect();
  let captured = 0;
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const total = (client.mailbox as any)?.exists ?? 0;
      if (total === 0) return 0;
      const start = Math.max(1, total - 99 + 1);
      for await (const msg of client.fetch(`${start}:*`, { source: true })) {
        try {
          const parsed = await simpleParser(msg.source as Buffer);
          const inReplyTo = parsed.inReplyTo;
          if (!inReplyTo || !knownSet.has(inReplyTo)) continue;

          const rfcMessageId = parsed.messageId ?? null;
          // Dedup
          if (rfcMessageId) {
            const [existing] = await db
              .select({ id: communications.id })
              .from(communications)
              .where(and(eq(communications.orgId, orgId), eq(communications.messageId, rfcMessageId)))
              .limit(1);
            if (existing) continue;
          }

          // Find original outbound
          const [original] = await db
            .select({ invoiceId: communications.invoiceId, customerId: communications.customerId, projectId: communications.projectId, contactId: communications.contactId })
            .from(communications)
            .where(and(eq(communications.orgId, orgId), eq(communications.messageId, inReplyTo)))
            .limit(1);
          if (!original) continue;

          await db.insert(communications).values({
            orgId,
            customerId: original.customerId,
            projectId:  original.projectId ?? null,
            invoiceId:  original.invoiceId ?? null,
            contactId:  original.contactId ?? null,
            direction:  "Inbound",
            channel:    "Email",
            subject:    parsed.subject ?? "",
            sender:     parsed.from?.text ?? "",
            body:       parsed.text ?? parsed.html ?? "",
            messageId:  rfcMessageId,
            inReplyTo,
            matchedBy:  "thread",
            sentAt:     parsed.date ?? new Date(),
          });
          captured++;
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
