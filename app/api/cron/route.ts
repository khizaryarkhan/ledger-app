import { NextResponse } from "next/server";
import { db } from "@/db";
import { invoices, contacts, customers, projects, emailTemplates, communications, organisations, invoicePromises } from "@/db/schema";
import { eq, and, or, isNull, lte, lt, inArray } from "drizzle-orm";
import { getSmtpConfig, sendEmail, hasEmailTransport } from "@/lib/mailer";
import { fetchQboInvoicePdf } from "@/lib/qbo-token";
import { fetchXeroInvoicePdf } from "@/lib/xero-token";
import { createPortalToken } from "@/lib/portal";
import { genEmailRef } from "@/lib/email-ref";
import { renderInvoiceEmail } from "@/lib/ar-email";
import { refreshRates } from "@/lib/fx-rates";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function daysFromDate(dateStr: string): number {
  const due = new Date(dateStr + "T12:00:00Z").getTime();
  return Math.floor((Date.now() - due) / 86400000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

const PAUSE_STAGES = ["Disputed", "On Hold", "Promised", "Promise to Pay"];

function fillTemplate(template: string, name: string, invoiceLines: string[], ref: string): string {
  return template
    .replace(/\{name\}/gi, name)
    .replace(/\{invoicelines\}/gi, invoiceLines.join("\n"))
    .replace(/\{ref\}/gi, ref);
}

// ─────────────────────────────────────────────────────────────────────────────
// CRON HANDLER
// Runs daily at 09:00 UTC (see vercel.json).
//
// Reliability guarantees:
//   • contacts.next_send_at drives scheduling — not wall-clock arithmetic.
//   • If the cron crashes mid-run, unprocessed contacts still have
//     next_send_at ≤ now and will be picked up on the very next run.
//   • Sending is idempotent per contact: we only advance next_send_at
//     AFTER a successful SMTP send.
//   • organisations.last_cron_run + last_cron_stats are updated at the end
//     of every run so admins can see exactly what happened.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now         = new Date();
  const today       = now.toISOString().slice(0, 10);
  let emailsSent    = 0;
  let skipped       = 0;
  let errors: string[] = [];

  // ── Load all invoices (needed for contact filtering) ─────────────────────
  const allInvoices = await db.select().from(invoices);

  // ── Send emails ───────────────────────────────────────────────────────────
  const allOrgs = [...new Set(allInvoices.map((inv) => inv.orgId))];

  for (const orgId of allOrgs) {
    const orgErrors: string[] = [];
    try {
      // Gate on ANY transport (Gmail / Microsoft / SMTP) — not SMTP only.
      if (!(await hasEmailTransport(orgId))) continue;
      const smtp = await getSmtpConfig(orgId).catch(() => null); // for default-CC + fallback sender label

      const orgTemplates = await db
        .select()
        .from(emailTemplates)
        .where(and(eq(emailTemplates.orgId, orgId), eq(emailTemplates.isActive, true)));

      const templateByStage = new Map(
        orgTemplates.filter((t) => t.collectionStage).map((t) => [t.collectionStage!, t]),
      );
      if (templateByStage.size === 0) continue;

      // Only load contacts that are due for a send right now.
      // next_send_at IS NULL  → never sent, fire immediately
      // next_send_at ≤ now   → interval has elapsed, fire again
      const dueContacts = await db
        .select()
        .from(contacts)
        .where(and(
          eq(contacts.orgId, orgId),
          eq(contacts.receivesAuto, true),
          or(isNull(contacts.nextSendAt), lte(contacts.nextSendAt, now)),
        ));

      const enabledContacts = dueContacts.filter((c) => c.email);

      for (const contact of enabledContacts) {
        try {
          // All open, non-paused invoices for this contact
          const relatedInvoices = allInvoices.filter((inv) => {
            if (inv.orgId !== orgId) return false;
            if (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off") return false;
            if ((inv.total - (inv.paid || 0)) <= 0) return false;
            if (PAUSE_STAGES.includes(inv.collectionStage)) return false;
            // Customer Response Portal: an open dispute pauses chasing for this
            // invoice until the dispute is resolved (auto-set by recomputeInvoiceState).
            if ((inv as any).automationsPaused) return false;
            if (contact.projectId) return inv.projectId === contact.projectId;
            return inv.customerId === contact.customerId;
          });

          // No open invoices → reset so we re-check on future runs when invoices re-open
          if (relatedInvoices.length === 0) {
            await db.update(contacts).set({ nextSendAt: null }).where(eq(contacts.id, contact.id));
            skipped++;
            continue;
          }

          // Find the template for the most overdue invoice's stage
          const sortedByOverdue = [...relatedInvoices].sort(
            (a, b) => daysFromDate(b.dueDate) - daysFromDate(a.dueDate),
          );
          const matchedInv = sortedByOverdue.find((inv) => templateByStage.has(inv.collectionStage));
          if (!matchedInv) { skipped++; continue; }

          const template     = templateByStage.get(matchedInv.collectionStage)!;
          const intervalDays = template.sendIntervalDays ?? 7;

          // Entity ref + names (for the branded email rows)
          let entityRef = "";
          let projName: string | null = null;
          const [custRow] = await db.select().from(customers).where(eq(customers.id, contact.customerId)).limit(1);
          const custName = custRow?.name ?? custRow?.code ?? null;
          if (contact.projectId) {
            const [proj] = await db.select().from(projects).where(eq(projects.id, contact.projectId)).limit(1);
            projName = proj?.name ?? null;
            entityRef = proj?.name ?? proj?.code ?? "";
          } else {
            entityRef = custRow?.code ?? custRow?.name ?? "";
          }

          // Build invoice lines — ALL open invoices go in the email
          const invoiceLines = relatedInvoices.map((inv) => {
            const balance    = inv.total - (inv.paid || 0);
            const d          = daysFromDate(inv.dueDate);
            const overdueStr = d > 0 ? `${d} days overdue` : d === 0 ? "due today" : `due in ${Math.abs(d)} days`;
            return `  • ${inv.invoiceNumber} — Balance: ${balance.toLocaleString("en-IE", { style: "currency", currency: inv.currency || "EUR" })} (${overdueStr})`;
          });

          const greeting = contact.name?.split(" ")[0] || "Sir/Madam";
          const emailRef = genEmailRef();
          const subject  = fillTemplate(template.subject, greeting, invoiceLines, entityRef) + ` | Ref ${emailRef}`;
          // Template body becomes the intro message; the branded table lists the
          // invoices (so we strip {invoicelines} to avoid duplicating the list).
          const introText = fillTemplate(template.body, greeting, [], entityRef);

          // Single-use "View & Respond" portal link → rendered as the branded button.
          let portalUrl: string | null = null;
          try {
            portalUrl = (await createPortalToken(orgId, contact.customerId, relatedInvoices.map((i) => i.id), null)).url;
          } catch (e: any) {
            console.warn("cron: portal link generation failed:", e?.message);
          }

          const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
          const bodyHtml = renderInvoiceEmail({
            subject, dateStr, portalUrl, intro: introText,
            total: relatedInvoices.reduce((s, i) => s + (i.total - (i.paid || 0)), 0),
            rows: relatedInvoices.map((i) => ({
              invoiceNumber: i.invoiceNumber, customerName: custName, projectName: projName,
              invoiceDate: i.invoiceDate, dueDate: i.dueDate, balance: i.total - (i.paid || 0),
              currency: i.currency, daysOverdue: daysFromDate(i.dueDate),
            })),
          });

          // PDF attachments (silent failures — email still sends without them).
          // Xero invoices pull the PDF from Xero; everything else from QuickBooks.
          const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
          for (const inv of relatedInvoices) {
            const pdf = (inv as any).xeroId
              ? await fetchXeroInvoicePdf(orgId, inv as any).catch(() => null)
              : await fetchQboInvoicePdf(orgId, inv).catch(() => null);
            if (pdf) attachments.push({ filename: `Invoice-${inv.invoiceNumber}.pdf`, content: pdf, contentType: "application/pdf" });
          }

          // ── SEND ── via the unified transport (same branded HTML as every channel)
          const sendResult = await sendEmail(orgId, {
            to: contact.email!,
            subject,
            body: bodyHtml,
            attachments: attachments.length > 0 ? attachments : undefined,
          });

          // ── Advance next_send_at ONLY after a confirmed successful send ──
          await db.update(contacts)
            .set({ nextSendAt: addDays(now, intervalDays) })
            .where(eq(contacts.id, contact.id));

          emailsSent++;

          // Log communication
          await db.insert(communications).values({
            orgId,
            customerId:  contact.customerId,
            projectId:   contact.projectId ?? null,
            invoiceId:   matchedInv.id,
            contactId:   contact.id,
            direction:   "Outbound",
            channel:     "Email",
            subject,
            body:        introText,
            sender:      sendResult.from,
            recipients:  contact.email!,
            matchedBy:   "Auto",
            isDraft:     false,
            stageAtSend: matchedInv.collectionStage,
            authorId:    null,
            refNumber:   emailRef,
          }).catch((err) => {
            console.warn(`cron: failed to log communication for ${contact.email}:`, err?.message);
          });

        } catch (contactErr: any) {
          const msg = `${contact.email}: ${contactErr.message}`;
          orgErrors.push(msg);
          errors.push(msg);
          // next_send_at is NOT advanced — contact will retry on next cron run
        }
      }
    } catch (orgErr: any) {
      errors.push(`Org ${orgId}: ${orgErr.message}`);
    }

    // ── Update org cron stats ──────────────────────────────────────────────
    await db.update(organisations)
      .set({
        lastCronRun:   now,
        lastCronStats: { emailsSent, skipped, errors: orgErrors },
      })
      .where(eq(organisations.id, orgId))
      .catch(() => {}); // never let stat-writing crash the response
  }

  // ── Broken-promise sweep — flip passed, unpaid Active promises to "Broken" ──
  let promisesBroken = 0;
  try {
    const stale = await db
      .select({
        id: invoicePromises.id,
        invoiceId: invoicePromises.invoiceId,
        customerId: invoicePromises.customerId,
        promiseDate: invoicePromises.promiseDate,
        orgId: invoicePromises.orgId,
        projectId: invoices.projectId,
        paymentStatus: invoices.paymentStatus,
      })
      .from(invoicePromises)
      .leftJoin(invoices, eq(invoices.id, invoicePromises.invoiceId))
      .where(and(eq(invoicePromises.status, "Active"), lt(invoicePromises.promiseDate, today)));
    const toBreak = stale.filter((s) => s.paymentStatus !== "Paid");
    const toBreakIds = toBreak.map((s) => s.id);
    for (let i = 0; i < toBreakIds.length; i += 100) {
      await db.update(invoicePromises).set({ status: "Broken" }).where(inArray(invoicePromises.id, toBreakIds.slice(i, i + 100)));
      promisesBroken += Math.min(100, toBreakIds.length - i);
    }
    // Log a chatbox entry for each broken promise so the board shows it
    if (toBreak.length > 0) {
      await db.insert(communications).values(
        toBreak.map(p => ({
          orgId: p.orgId,
          customerId: p.customerId!,
          invoiceId: p.invoiceId ?? undefined,
          projectId: p.projectId ?? undefined,
          direction: "Inbound" as const,
          channel: "Promise",
          subject: "Promise broken",
          body: `Promise was due ${p.promiseDate} — marked broken. Invoice still unpaid.`,
          sender: "System",
          matchedBy: "System",
          isDraft: false,
        }))
      ).catch(() => {});
    }
  } catch (e: any) {
    console.warn("cron: broken-promise sweep failed:", e?.message);
  }

  // ── Refresh FX rates for all distinct home currencies in use ──────────────
  try {
    const orgs = await db.select({ currency: organisations.currency }).from(organisations);
    const bases = [...new Set(orgs.map((o) => o.currency).filter(Boolean))];
    await Promise.allSettled(bases.map((b) => refreshRates(b)));
  } catch (e: any) {
    console.warn("cron: FX rate refresh failed:", e?.message);
  }

  return NextResponse.json({ ran: today, emailsSent, skipped, promisesBroken, errors: errors.length > 0 ? errors : undefined });
}
