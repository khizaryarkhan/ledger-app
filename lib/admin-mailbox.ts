import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import * as nodemailer from "nodemailer";
import { db } from "@/db";
import { adminEmailAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decryptSecret } from "@/lib/crypto";
import { sendSystemEmail } from "@/lib/system-mailer";

export type MailboxConfig = {
  emailAddress: string;
  fromName?: string | null;
  imapHost: string; imapPort: number;
  smtpHost: string; smtpPort: number;
  username: string;
  password: string;
};

export type MessageSummary = {
  uid: number; seq: number;
  subject: string; from: string; fromName: string;
  to: string; date: string | null; seen: boolean; hasAttachments: boolean;
  preview: string;
};

// Load + decrypt the stored mailbox for an admin. Returns null if not connected.
export async function getMailbox(userId: string): Promise<MailboxConfig | null> {
  const [row] = await db.select().from(adminEmailAccounts).where(eq(adminEmailAccounts.userId, userId)).limit(1);
  if (!row) return null;
  const password = decryptSecret(row.passwordEnc);
  if (!password) return null;
  return {
    emailAddress: row.emailAddress, fromName: row.fromName,
    imapHost: row.imapHost, imapPort: row.imapPort,
    smtpHost: row.smtpHost, smtpPort: row.smtpPort,
    username: row.username, password,
  };
}

function imapClient(cfg: MailboxConfig) {
  return new ImapFlow({
    host: cfg.imapHost, port: cfg.imapPort, secure: cfg.imapPort === 993,
    auth: { user: cfg.username, pass: cfg.password },
    logger: false,
    // give up reasonably fast on a bad host so the route doesn't hang
    socketTimeout: 20000,
  } as any);
}

function smtpTransport(cfg: MailboxConfig) {
  return nodemailer.createTransport({
    host: cfg.smtpHost, port: cfg.smtpPort, secure: cfg.smtpPort === 465,
    auth: { user: cfg.username, pass: cfg.password },
  });
}

// Verify both IMAP login and SMTP auth — used when connecting an account.
export async function verifyMailbox(cfg: MailboxConfig): Promise<{ ok: boolean; error?: string }> {
  // IMAP
  const imap = imapClient(cfg);
  try {
    await imap.connect();
    await imap.logout();
  } catch (e: any) {
    return { ok: false, error: `IMAP: ${e?.message ?? "could not connect"}` };
  }
  // SMTP
  try {
    await smtpTransport(cfg).verify();
  } catch (e: any) {
    return { ok: false, error: `SMTP: ${e?.message ?? "could not connect"}` };
  }
  return { ok: true };
}

function addrText(a: any): { text: string; name: string } {
  const first = a?.value?.[0];
  return { text: a?.text ?? "", name: first?.name || first?.address || a?.text || "" };
}

// List the most recent messages in a mailbox (newest first).
export async function listMessages(cfg: MailboxConfig, mailbox = "INBOX", limit = 50): Promise<MessageSummary[]> {
  const imap = imapClient(cfg);
  const out: MessageSummary[] = [];
  await imap.connect();
  try {
    const lock = await imap.getMailboxLock(mailbox);
    try {
      const status: any = imap.mailbox;
      const total = status?.exists ?? 0;
      if (total === 0) return [];
      const start = Math.max(1, total - limit + 1);
      for await (const msg of imap.fetch(`${start}:*`, { envelope: true, flags: true, bodyStructure: true })) {
        const env = msg.envelope;
        const from = env?.from?.[0];
        out.push({
          uid: msg.uid, seq: msg.seq,
          subject: env?.subject || "(no subject)",
          from: from?.address || "",
          fromName: from?.name || from?.address || "",
          to: (env?.to || []).map((t: any) => t.address).join(", "),
          date: env?.date ? new Date(env.date).toISOString() : null,
          seen: msg.flags?.has("\\Seen") ?? false,
          hasAttachments: hasAttach(msg.bodyStructure),
          preview: "",
        });
      }
    } finally { lock.release(); }
  } finally { await imap.logout(); }
  return out.reverse(); // newest first
}

function hasAttach(struct: any): boolean {
  if (!struct) return false;
  if (struct.disposition === "attachment") return true;
  if (Array.isArray(struct.childNodes)) return struct.childNodes.some(hasAttach);
  return false;
}

// Find inbound messages in INBOX sent FROM any of the given addresses — used to
// surface a lead's replies on their CRM timeline.
export async function searchInboundFrom(cfg: MailboxConfig, emails: string[], limit = 25): Promise<MessageSummary[]> {
  const addrs = emails.map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!addrs.length) return [];
  const imap = imapClient(cfg);
  const out: MessageSummary[] = [];
  await imap.connect();
  try {
    const lock = await imap.getMailboxLock("INBOX");
    try {
      let uids: number[] = [];
      for (const em of addrs) {
        try { const found = await imap.search({ from: em }, { uid: true }); if (Array.isArray(found)) uids.push(...found); } catch {}
      }
      uids = [...new Set(uids)].sort((a, b) => b - a).slice(0, limit);
      if (uids.length) {
        for await (const msg of imap.fetch(uids, { envelope: true, flags: true, bodyStructure: true }, { uid: true })) {
          const env = msg.envelope; const from = env?.from?.[0];
          out.push({
            uid: msg.uid, seq: msg.seq,
            subject: env?.subject || "(no subject)",
            from: from?.address || "", fromName: from?.name || from?.address || "",
            to: (env?.to || []).map((t: any) => t.address).join(", "),
            date: env?.date ? new Date(env.date).toISOString() : null,
            seen: msg.flags?.has("\\Seen") ?? false,
            hasAttachments: hasAttach(msg.bodyStructure), preview: "",
          });
        }
      }
    } finally { lock.release(); }
  } finally { await imap.logout(); }
  return out.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
}

// Fetch a single message's full content (parsed) by UID.
export async function getMessage(cfg: MailboxConfig, uid: number, mailbox = "INBOX") {
  const imap = imapClient(cfg);
  await imap.connect();
  try {
    const lock = await imap.getMailboxLock(mailbox);
    try {
      const msg = await imap.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) return null;
      const parsed = await simpleParser(msg.source as Buffer);
      // mark as read
      try { await imap.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true } as any); } catch {}
      return {
        uid,
        subject: parsed.subject || "(no subject)",
        from: addrText(parsed.from),
        to: parsed.to ? addrText(parsed.to).text : "",
        cc: parsed.cc ? addrText(parsed.cc).text : "",
        date: parsed.date ? parsed.date.toISOString() : null,
        messageId: parsed.messageId || null,
        inReplyTo: parsed.inReplyTo || null,
        html: parsed.html || null,
        text: parsed.text || "",
        attachments: (parsed.attachments || []).map(a => ({ filename: a.filename || "attachment", size: a.size, contentType: a.contentType })),
      };
    } finally { lock.release(); }
  } finally { await imap.logout(); }
}

/**
 * Send real outbound communication on behalf of an admin.
 * Prefers the admin's OWN connected mailbox (so it goes from their personal
 * @primeaccountax.com address). Falls back to the system mailer only when
 * `allowSystemFallback` is true and the admin has no mailbox connected — used
 * for automated sequences so drips don't silently stop. Interactive 1:1 sends
 * should pass allowSystemFallback=false to guarantee they never use support@.
 */
export async function sendAdminEmail(
  userId: string | null,
  msg: { to: string; cc?: string[] | string; subject: string; html?: string; text?: string },
  allowSystemFallback = false,
): Promise<{ from: string; viaPersonal: boolean }> {
  const cfg = userId ? await getMailbox(userId) : null;
  const ccArr = Array.isArray(msg.cc) ? msg.cc.filter(Boolean) : (msg.cc ? [msg.cc] : []);

  if (cfg) {
    await sendMessage(cfg, { to: msg.to, cc: ccArr.join(", ") || undefined, subject: msg.subject, html: msg.html, text: msg.text });
    return { from: cfg.emailAddress, viaPersonal: true };
  }
  if (!allowSystemFallback) {
    throw new Error("No personal mailbox connected. Connect your mailbox under Mail to send from your own address.");
  }
  await sendSystemEmail({ to: msg.to, subject: msg.subject, html: msg.html ?? msg.text ?? "", cc: ccArr.length ? ccArr : undefined });
  return { from: "system", viaPersonal: false };
}

// Send a message via the admin's SMTP, and append a copy to Sent.
export async function sendMessage(cfg: MailboxConfig, msg: { to: string; cc?: string; bcc?: string; subject: string; html?: string; text?: string }) {
  const from = cfg.fromName ? `${cfg.fromName} <${cfg.emailAddress}>` : cfg.emailAddress;
  const info = await smtpTransport(cfg).sendMail({
    from, to: msg.to, cc: msg.cc || undefined, bcc: msg.bcc || undefined, subject: msg.subject,
    text: msg.text || undefined, html: msg.html || undefined,
  });

  // Best-effort: append to the Sent folder so it shows in their mailbox too.
  try {
    const imap = imapClient(cfg);
    await imap.connect();
    try {
      const raw = `From: ${from}\r\nTo: ${msg.to}\r\n${msg.cc ? `Cc: ${msg.cc}\r\n` : ""}Subject: ${msg.subject}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${msg.html || msg.text || ""}`;
      for (const box of ["Sent", "Sent Items", "INBOX.Sent"]) {
        try { await imap.append(box, Buffer.from(raw), ["\\Seen"]); break; } catch {}
      }
    } finally { await imap.logout(); }
  } catch {}

  return { messageId: info.messageId };
}
