import { db } from "@/db";
import { adminEmailAccounts, landingPageRequests, leadSequenceEnrollments, crmEmails } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getMailbox, listMessages, getMessage } from "@/lib/admin-mailbox";
import { recordEmail } from "@/lib/admin/emails";
import { logActivity } from "@/lib/admin/activities";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel Cron — pulls inbound replies from every connected admin mailbox,
// persists them to the durable email store (threaded + linked to the account),
// auto-stops sequences for leads who replied, and logs the reply to the timeline.
// Bypassed by middleware (/api/cron) → guarded ONLY by CRON_SECRET.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Map every known lead email → its lead/account.
  const leads = await db.select({ id: landingPageRequests.id, email: landingPageRequests.email, accountId: landingPageRequests.accountId, status: landingPageRequests.status }).from(landingPageRequests);
  const byEmail = new Map(leads.map(l => [l.email.toLowerCase(), l]));

  const mailboxes = await db.select({ userId: adminEmailAccounts.userId }).from(adminEmailAccounts).where(eq(adminEmailAccounts.status, "active"));

  let scanned = 0, captured = 0, stopped = 0, mailboxesOk = 0;

  for (const mb of mailboxes) {
    const cfg = await getMailbox(mb.userId).catch(() => null);
    if (!cfg) continue;
    try {
      const recent = await listMessages(cfg, "INBOX", 60);
      mailboxesOk++;
      for (const m of recent) {
        const lead = m.from ? byEmail.get(m.from.toLowerCase()) : undefined;
        if (!lead) continue; // not from a known lead — skip
        scanned++;
        // Full parse for body + Message-ID (dedup + threading).
        const full = await getMessage(cfg, m.uid, "INBOX").catch(() => null);
        if (!full) continue;
        if (full.messageId) {
          const [dupe] = await db.select({ id: crmEmails.id }).from(crmEmails).where(eq(crmEmails.messageId, full.messageId)).limit(1);
          if (dupe) continue; // already captured on an earlier run
        }

        await recordEmail({
          direction: "inbound", fromAddr: m.from, toAddr: full.to || cfg.emailAddress,
          cc: full.cc || null, subject: full.subject, bodyHtml: full.html, bodyText: full.text,
          messageId: full.messageId, inReplyTo: full.inReplyTo,
          leadId: lead.id, accountId: lead.accountId, mailboxUserId: mb.userId,
          occurredAt: full.date ? new Date(full.date) : undefined,
        });
        captured++;

        // Reply-stop: cancel active sequences + advance status (one place).
        const cancelled = await db.update(leadSequenceEnrollments)
          .set({ status: "cancelled" })
          .where(and(eq(leadSequenceEnrollments.leadId, lead.id), eq(leadSequenceEnrollments.status, "active")))
          .returning({ id: leadSequenceEnrollments.id });
        if (cancelled.length) stopped += cancelled.length;
        if (lead.status === "new") {
          await db.update(landingPageRequests).set({ status: "contacted" }).where(eq(landingPageRequests.id, lead.id)).catch(() => {});
        }

        await logActivity({
          type: "email_received", title: `Reply: ${full.subject ?? "(no subject)"}`.slice(0, 300),
          body: (full.text || "").replace(/\s+/g, " ").trim().slice(0, 300) || undefined,
          leadId: lead.id, accountId: lead.accountId,
          meta: cancelled.length ? { sequencesStopped: cancelled.length } : undefined,
        });
      }
    } catch (e: any) {
      // One bad mailbox must not stop the others.
      console.error("[cron/sync-inbound]", cfg.emailAddress, e?.message);
    }
  }

  return NextResponse.json({ ok: true, mailboxes: mailboxesOk, scanned, captured, sequencesStopped: stopped });
}
