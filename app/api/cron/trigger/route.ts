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
import { invoices, contacts, customers, projects, emailTemplates, communications } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrg } from "@/lib/api";
import { getSmtpConfig, sendSmtp } from "@/lib/mailer";

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

  // 1. SMTP config
  const smtp = await getSmtpConfig(orgId!);
  if (!smtp) {
    return NextResponse.json(
      { error: "Email not configured. Go to Settings → Email to set up SMTP credentials." },
      { status: 422 },
    );
  }

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
    let entityName = "";
    let entityRef  = "";
    if (contact.projectId) {
      const [proj] = await db.select().from(projects).where(eq(projects.id, contact.projectId)).limit(1);
      entityName = proj?.name ?? contact.projectId;
      entityRef  = proj?.code ?? "";
    } else {
      const [cust] = await db.select().from(customers).where(eq(customers.id, contact.customerId)).limit(1);
      entityName = cust?.name ?? contact.customerId;
      entityRef  = cust?.code ?? "";
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
    const subjectParts = [fillTemplate(template.subject, greeting, invoiceLines, entityRef)];
    subjectParts.push(`Ref: ${invRefs.join(", ")}`);
    const subject = subjectParts.join(" | ");

    const bodyText = fillTemplate(template.body, greeting, invoiceLines, entityRef);

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
        await sendSmtp(smtp, {
          to:      contact.email!,
          subject,
          body:    bodyText,
        });
        detail.sent = true;
        sent++;

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
          body:        bodyText,
          sender:      smtp.fromEmail,
          recipients:  contact.email!,
          matchedBy:   "Auto",
          isDraft:     false,
          stageAtSend: matchedInv.collectionStage,
          authorId:    (session?.user as any)?.id ?? null,
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

  return NextResponse.json({ sent, skipped, dryRun, details });
}
