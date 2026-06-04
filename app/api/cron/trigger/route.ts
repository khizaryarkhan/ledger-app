/**
 * POST /api/cron/trigger
 *
 * Manually send collection emails for the requesting org via SMTP.
 * Protected by normal session auth — no CRON_SECRET needed.
 *
 * Fires for every open invoice that is pre-due (≤3 days) or overdue (≥1 day).
 * Email content is driven entirely by the EMAIL TEMPLATE assigned to the
 * invoice's current collectionStage — the tool never decides wording based on
 * age numbers.  If no template is assigned to a stage, that invoice is skipped.
 *
 * Body: { dryRun?: boolean }
 *   dryRun = true  → preview what would be sent, send nothing
 *   dryRun = false → send emails via SMTP and log to communications
 *
 * Response:
 *   { sent, skipped, dryRun, details[] }
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { invoices, contacts, customers, projects, emailTemplates, communications, organisations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createPortalToken } from "@/lib/portal";
import { genEmailRef } from "@/lib/email-ref";

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
import { requireOrg } from "@/lib/api";
import { getSmtpConfig, sendEmail, hasEmailTransport } from "@/lib/mailer";
import { fetchQboInvoicePdf } from "@/lib/qbo-token";
import { renderInvoiceEmail } from "@/lib/ar-email";

// ─── helpers ─────────────────────────────────────────────────────────────────

function daysFromDate(dateStr: string): number {
  const due = new Date(dateStr + "T12:00:00Z").getTime();
  return Math.floor((Date.now() - due) / 86400000);
}

const PAUSE_STAGES = ["Disputed", "On Hold", "Promised", "Promise to Pay"];

/** True if invoice is within the pre-due or overdue window that warrants sending */
function shouldTrigger(daysOverdue: number): boolean {
  if (daysOverdue <= -1 && daysOverdue >= -3) return true; // 1–3 days before due
  if (daysOverdue >= 1) return true;                        // any overdue amount
  return false;
}

/**
 * Fill template placeholders.
 * {name}         → contact first name (or Sir/Madam)
 * {invoiceLines} → bullet list of invoice numbers, balances, overdue status
 * {ref}          → entity code (customer / project)
 */
function fillTemplate(
  template: string,
  name: string,
  invoiceLines: string[],
  ref: string,
): string {
  return template
    .replace(/\{name\}/gi, name)
    .replace(/\{invoicelines\}/gi, invoiceLines.join("\n"))
    .replace(/\{ref\}/gi, ref);
}

// ─── handler ─────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const dryRun: boolean = body.dryRun === true;

  // 1. Email transport — Gmail / Microsoft / SMTP (any one)
  if (!(await hasEmailTransport(orgId!))) {
    return NextResponse.json(
      { error: "Email not configured. Connect Gmail, Microsoft, or SMTP in Settings → Email." },
      { status: 422 },
    );
  }
  const smtp = await getSmtpConfig(orgId!).catch(() => null); // for fallback sender label

  // 2. Load org templates (stage → template map)
  const orgTemplates = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.orgId, orgId!), eq(emailTemplates.isActive, true)));

  const templateByStage = new Map(
    orgTemplates
      .filter((t) => t.collectionStage)
      .map((t) => [t.collectionStage!, t]),
  );

  // 3. Load all auto contacts for this org
  const autoContacts = await db
    .select().from(contacts)
    .where(and(eq(contacts.orgId, orgId!), eq(contacts.receivesAuto, true)));

  const enabledContacts = autoContacts.filter((c) => c.email);
  if (enabledContacts.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0, dryRun, details: [], message: "No contacts with automation enabled." });
  }

  // 4. Load all open invoices for this org
  const orgInvoices = await db.select().from(invoices).where(eq(invoices.orgId, orgId!));

  // 5. Process each contact
  type Detail = {
    contact: string;
    entity: string;
    stage: string;
    templateName: string;
    invoices: string[];
    sent: boolean;
    error?: string;
  };
  const details: Detail[] = [];
  let sent = 0;
  let skipped = 0;

  for (const contact of enabledContacts) {
    // Invoices relevant to this contact
    const relatedInvoices = orgInvoices.filter((inv) => {
      if (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off") return false;
      if ((inv.total - (inv.paid || 0)) <= 0) return false;
      if (PAUSE_STAGES.includes(inv.collectionStage)) return false;
      if (contact.projectId) return inv.projectId === contact.projectId;
      return inv.customerId === contact.customerId;
    });

    if (relatedInvoices.length === 0) { skipped++; continue; }

    // Keep only invoices within the trigger window
    const triggeredInvoices = relatedInvoices.filter((inv) =>
      shouldTrigger(daysFromDate(inv.dueDate))
    );
    if (triggeredInvoices.length === 0) { skipped++; continue; }

    // Find the first invoice (most overdue) whose stage has a template
    const sortedByOverdue = [...triggeredInvoices].sort(
      (a, b) => daysFromDate(b.dueDate) - daysFromDate(a.dueDate)
    );
    const matchedInv = sortedByOverdue.find((inv) => templateByStage.has(inv.collectionStage));

    if (!matchedInv) { skipped++; continue; } // no template configured for any of these stages

    const template = templateByStage.get(matchedInv.collectionStage)!;

    // Entity info
    // {ref} = project full name (not QBO code) for projects; customer code for customers
    let entityName = "";
    let entityRef  = "";
    let projName: string | null = null;
    const [custRow] = await db.select().from(customers).where(eq(customers.id, contact.customerId)).limit(1);
    const custName = custRow?.name ?? null;
    if (contact.projectId) {
      const [proj] = await db.select().from(projects).where(eq(projects.id, contact.projectId)).limit(1);
      projName   = proj?.name ?? null;
      entityName = proj?.name ?? contact.projectId;
      entityRef  = proj?.name ?? proj?.code ?? ""; // use full project name, not QBO code
    } else {
      entityName = custRow?.name ?? contact.customerId;
      entityRef  = custRow?.code ?? custRow?.name ?? "";
    }

    // Build invoice lines for the body placeholder
    const invoiceLines = triggeredInvoices.map((inv) => {
      const balance = inv.total - (inv.paid || 0);
      const d = daysFromDate(inv.dueDate);
      const overdueStr = d > 0 ? `${d} days overdue` : d === 0 ? "due today" : `due in ${Math.abs(d)} days`;
      return `  • ${inv.invoiceNumber} — Balance: ${balance.toLocaleString("en-IE", { style: "currency", currency: inv.currency || "EUR" })} (${overdueStr})`;
    });

    const greeting = contact.name?.split(" ")[0] || "Sir/Madam";
    const invRefs  = triggeredInvoices.map((inv) => inv.invoiceNumber);

    // Subject: fill placeholders + append invoice refs
    const emailRef = genEmailRef();
    const subjectParts = [fillTemplate(template.subject, greeting, invoiceLines, entityRef)];
    subjectParts.push(`Ref ${emailRef}`);
    const subject = subjectParts.join(" | ");

    const introText = fillTemplate(template.body, greeting, [], entityRef);

    // Self-service "View & Respond" portal link (single-use) → branded button
    let portalUrl: string | null = null;
    try {
      portalUrl = (await createPortalToken(orgId!, contact.customerId, triggeredInvoices.map((i) => i.id), null)).url;
    } catch (e: any) {
      console.warn("trigger: portal link generation failed:", e?.message);
    }

    const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const bodyHtml = renderInvoiceEmail({
      subject, dateStr, portalUrl, intro: introText,
      total: triggeredInvoices.reduce((s, i) => s + (i.total - (i.paid || 0)), 0),
      rows: triggeredInvoices.map((i) => ({
        invoiceNumber: i.invoiceNumber, customerName: custName, projectName: projName,
        invoiceDate: i.invoiceDate, dueDate: i.dueDate, balance: i.total - (i.paid || 0),
        currency: i.currency, daysOverdue: daysFromDate(i.dueDate),
      })),
    });

    // Fetch PDF attachments from QBO for each triggered invoice
    // Failures are silent — the email still sends without the attachment
    const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
    if (!dryRun) {
      for (const inv of triggeredInvoices) {
        const pdf = await fetchQboInvoicePdf(orgId!, inv).catch(() => null);
        if (pdf) {
          attachments.push({
            filename:    `Invoice-${inv.invoiceNumber}.pdf`,
            content:     pdf,
            contentType: "application/pdf",
          });
        }
      }
    }

    const detail: Detail = {
      contact:      contact.email!,
      entity:       entityName,
      stage:        matchedInv.collectionStage,
      templateName: template.name,
      invoices:     invRefs,
      sent:         false,
    };

    if (!dryRun) {
      try {
        const sendResult = await sendEmail(orgId!, {
          to:          contact.email!,
          subject,
          body:        bodyHtml,
          attachments: attachments.length > 0 ? attachments : undefined,
        });
        detail.sent = true;
        sent++;

        // Advance next_send_at so cron doesn't double-send right after a manual trigger
        await db.update(contacts)
          .set({ nextSendAt: addDays(new Date(), template.sendIntervalDays ?? 7) })
          .where(eq(contacts.id, contact.id))
          .catch(() => {});

        // Log to communications so it appears in Inbox and customer/project timeline
        await db.insert(communications).values({
          orgId:       orgId!,
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
          authorId:    (session?.user as any)?.id ?? null,
          refNumber:   emailRef,
        }).catch((err) => {
          console.warn("trigger: failed to log communication for", contact.email, err?.message);
        });
      } catch (e: any) {
        detail.error = e.message;
        skipped++;
      }
    } else {
      detail.sent = true;
      sent++;
    }

    details.push(detail);
  }

  // ── Persist run stats so the CronStatusBanner reflects manual triggers too ──
  if (!dryRun) {
    await db.update(organisations)
      .set({
        lastCronRun:   new Date(),
        lastCronStats: { emailsSent: sent, skipped, errors: details.filter(d => d.error).map(d => `${d.contact}: ${d.error}`) },
      })
      .where(eq(organisations.id, orgId!))
      .catch(() => {}); // never let stat-writing crash the response
  }

  return NextResponse.json({ sent, skipped, dryRun, details });
}
