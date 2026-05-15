import { NextResponse } from "next/server";
import { db } from "@/db";
import { invoices, contacts, customers, projects, emailTemplates, communications } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSmtpConfig, sendSmtp } from "@/lib/mailer";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function daysFromDate(dateStr: string): number {
  const due = new Date(dateStr + "T12:00:00Z").getTime();
  return Math.floor((Date.now() - due) / 86400000);
}

const PROTECTED_STAGES = ["Disputed", "On Hold", "Escalated"];
const PAUSE_STAGES     = ["Disputed", "On Hold", "Promised", "Promise to Pay"];

/**
 * Returns true on the specific days a scheduled reminder should fire.
 * The CRON decides WHEN to fire — the invoice's collectionStage + template
 * decides WHAT to say.  No wording is ever picked based on age numbers.
 */
function shouldFireToday(daysOverdue: number): boolean {
  return (
    daysOverdue === -3 ||  // 3 days before due
    daysOverdue === 1  ||  // 1 day overdue
    daysOverdue === 8  ||  // 8 days overdue
    daysOverdue === 21     // 21 days overdue
  );
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

// ─────────────────────────────────────────────────────────────────────────────
// CRON HANDLER
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  let escalated    = 0;
  let emailsSent   = 0;
  let errors: string[] = [];

  // ── 1. Stage escalation ───────────────────────────────────────────────────
  const allInvoices = await db.select().from(invoices);

  for (const inv of allInvoices) {
    if (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off") continue;
    const daysOverdue = daysFromDate(inv.dueDate);
    if (daysOverdue > 30 && !PROTECTED_STAGES.includes(inv.collectionStage)) {
      await db.update(invoices)
        .set({ collectionStage: "Escalated", updatedAt: new Date() })
        .where(eq(invoices.id, inv.id));
      escalated++;
    }
  }

  // ── 2. Send emails via SMTP (stage-based templates) ───────────────────────
  const allOrgs = [...new Set(allInvoices.map((inv) => inv.orgId))];

  for (const orgId of allOrgs) {
    try {
      const smtp = await getSmtpConfig(orgId).catch(() => null);
      if (!smtp) continue; // org has no SMTP configured — skip

      // Load active templates for this org, keyed by collectionStage
      const orgTemplates = await db
        .select()
        .from(emailTemplates)
        .where(and(eq(emailTemplates.orgId, orgId), eq(emailTemplates.isActive, true)));

      const templateByStage = new Map(
        orgTemplates
          .filter((t) => t.collectionStage)
          .map((t) => [t.collectionStage!, t]),
      );

      if (templateByStage.size === 0) continue; // org has no templates set up

      const autoContacts = await db.select().from(contacts)
        .where(and(eq(contacts.orgId, orgId), eq(contacts.receivesAuto, true)));
      const enabledContacts = autoContacts.filter((c) => c.email);
      if (enabledContacts.length === 0) continue;

      for (const contact of enabledContacts) {
        try {
          const relatedInvoices = allInvoices.filter((inv) => {
            if (inv.orgId !== orgId) return false;
            if (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off") return false;
            if ((inv.total - (inv.paid || 0)) <= 0) return false;
            if (PAUSE_STAGES.includes(inv.collectionStage)) return false;
            if (contact.projectId) return inv.projectId === contact.projectId;
            return inv.customerId === contact.customerId;
          });

          if (relatedInvoices.length === 0) continue;

          // Keep only invoices that hit a scheduled day threshold today
          const triggeredInvoices = relatedInvoices.filter((inv) =>
            shouldFireToday(daysFromDate(inv.dueDate))
          );
          if (triggeredInvoices.length === 0) continue;

          // Find the most overdue invoice that has a template for its stage
          const sortedByOverdue = [...triggeredInvoices].sort(
            (a, b) => daysFromDate(b.dueDate) - daysFromDate(a.dueDate)
          );
          const matchedInv = sortedByOverdue.find((inv) => templateByStage.has(inv.collectionStage));
          if (!matchedInv) continue;

          const template = templateByStage.get(matchedInv.collectionStage)!;

          let entityRef = "";
          if (contact.projectId) {
            const [proj] = await db.select().from(projects).where(eq(projects.id, contact.projectId)).limit(1);
            entityRef = proj?.code ?? "";
          } else {
            const [cust] = await db.select().from(customers).where(eq(customers.id, contact.customerId)).limit(1);
            entityRef = cust?.code ?? "";
          }

          const invoiceLines = triggeredInvoices.map((inv) => {
            const balance = inv.total - (inv.paid || 0);
            const d = daysFromDate(inv.dueDate);
            const overdueStr = d > 0 ? `${d} days overdue` : d === 0 ? "due today" : `due in ${Math.abs(d)} days`;
            return `  • ${inv.invoiceNumber} — Balance: ${balance.toLocaleString("en-IE", { style: "currency", currency: inv.currency || "EUR" })} (${overdueStr})`;
          });

          const greeting = contact.name?.split(" ")[0] || "Sir/Madam";
          const invRefs  = triggeredInvoices.map((inv) => inv.invoiceNumber).join(", ");

          const subjectParts = [fillTemplate(template.subject, greeting, invoiceLines, entityRef)];
          subjectParts.push(`Ref: ${invRefs}`);
          const subject = subjectParts.join(" | ");

          const bodyText = fillTemplate(template.body, greeting, invoiceLines, entityRef);

          // Send via SMTP
          await sendSmtp(smtp, { to: contact.email!, subject, body: bodyText });
          emailsSent++;

          // Log to communications so it appears in Inbox and customer/project timeline
          await db.insert(communications).values({
            orgId:       orgId,
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
            authorId:    null,
          }).catch((err) => {
            console.warn(`cron: failed to log communication for ${contact.email}:`, err?.message);
          });

        } catch (contactErr: any) {
          errors.push(`Contact ${contact.email}: ${contactErr.message}`);
        }
      }
    } catch (orgErr: any) {
      errors.push(`Org ${orgId}: ${orgErr.message}`);
    }
  }

  return NextResponse.json({
    ran: today,
    escalated,
    emailsSent,
    errors: errors.length > 0 ? errors : undefined,
  });
}
