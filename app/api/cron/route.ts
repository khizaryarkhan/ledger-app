import { NextResponse } from "next/server";
import { db } from "@/db";
import { invoices, contacts, customers, projects, orgSmtpSettings, qboTokens } from "@/db/schema";
import { lt, eq, and, ne, isNotNull } from "drizzle-orm";
import * as nodemailer from "nodemailer";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function daysFromDate(dateStr: string): number {
  // Positive = overdue, negative = not yet due
  const due = new Date(dateStr + "T12:00:00Z").getTime();
  return Math.floor((Date.now() - due) / 86400000);
}

const PROTECTED_STAGES = ["Disputed", "On Hold", "Escalated"];
const PAUSE_STAGES     = ["Disputed", "On Hold", "Promised", "Promise to Pay"];

/** Returns the reminder type for today, or null if no reminder should fire */
function getReminderType(daysOverdue: number): string | null {
  if (daysOverdue === -3) return "pre-due";       // 3 days before due
  if (daysOverdue === 1)  return "first-notice";  // 1 day overdue
  if (daysOverdue === 8)  return "second-notice"; // 8 days overdue
  if (daysOverdue === 21) return "final-notice";  // 21 days overdue
  return null;
}

const REMINDER_SUBJECTS: Record<string, string> = {
  "pre-due":      "Upcoming Payment Reminder",
  "first-notice": "Payment Reminder — Invoice Now Overdue",
  "second-notice":"Second Notice — Outstanding Invoice",
  "final-notice": "Final Notice — Immediate Payment Required",
};

const REMINDER_BODIES: Record<string, (name: string, lines: string[]) => string> = {
  "pre-due": (name, lines) =>
    `Dear ${name},\n\nThis is a friendly reminder that the following invoice${lines.length > 1 ? "s" : ""} will be due in the coming days. Please arrange payment at your earliest convenience.\n\n${lines.join("\n")}\n\nIf payment has already been made please disregard this message.\n\nKind regards`,
  "first-notice": (name, lines) =>
    `Dear ${name},\n\nWe would like to bring to your attention that the following invoice${lines.length > 1 ? "s" : ""} ${lines.length > 1 ? "are" : "is"} now overdue.\n\n${lines.join("\n")}\n\nPlease arrange payment as soon as possible. If you have already remitted payment, please accept our apologies for this reminder.\n\nKind regards`,
  "second-notice": (name, lines) =>
    `Dear ${name},\n\nDespite our previous reminder, the following invoice${lines.length > 1 ? "s remain" : " remains"} outstanding.\n\n${lines.join("\n")}\n\nWe kindly request that you arrange immediate payment or contact us to discuss payment arrangements.\n\nKind regards`,
  "final-notice": (name, lines) =>
    `Dear ${name},\n\nThis is our final notice regarding the following overdue invoice${lines.length > 1 ? "s" : ""}.\n\n${lines.join("\n")}\n\nImmediate payment is required to avoid further action. Please contact us urgently if you are experiencing difficulty.\n\nKind regards`,
};

async function getRefreshedToken(orgId: string) {
  const [token] = await db.select().from(qboTokens).where(eq(qboTokens.orgId, orgId)).limit(1);
  if (!token) return null;
  const now = Date.now();
  if (new Date(token.accessTokenExpiresAt).getTime() - now < 5 * 60 * 1000) {
    const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refreshToken }),
    });
    if (!res.ok) return token;
    const d = await res.json();
    await db.update(qboTokens).set({
      accessToken: d.access_token,
      refreshToken: d.refresh_token || token.refreshToken,
      accessTokenExpiresAt: new Date(now + (d.expires_in || 3600) * 1000),
      updatedAt: new Date(),
    }).where(eq(qboTokens.orgId, orgId));
    return { ...token, accessToken: d.access_token };
  }
  return token;
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
  let escalated = 0;
  let remindersSent = 0;
  let reminderErrors: string[] = [];

  // ── 1. Stage escalation (existing logic) ──────────────────────────────────
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

  // ── 2. Reminder emails ────────────────────────────────────────────────────
  // Get all SMTP-configured orgs
  const smtpConfigs = await db.select().from(orgSmtpSettings);

  for (const smtp of smtpConfigs) {
    if (!smtp.host || !smtp.user || !smtp.pass || !smtp.fromEmail) continue;
    const orgId = smtp.orgId;

    try {
      // Get all contacts in this org with receivesAuto = true and an email
      const autoContacts = await db.select().from(contacts)
        .where(and(eq(contacts.orgId, orgId), eq(contacts.receivesAuto, true)));

      const enabledContacts = autoContacts.filter((c) => c.email);
      if (enabledContacts.length === 0) continue;

      // Build transporter for this org
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: false,
        auth: { user: smtp.user, pass: smtp.pass },
      });
      const from = smtp.fromName ? `"${smtp.fromName}" <${smtp.fromEmail}>` : smtp.fromEmail;

      // Get QBO token for PDF attachment (optional — graceful fallback)
      const qboToken = await getRefreshedToken(orgId).catch(() => null);
      const QBO_API  = "https://quickbooks.api.intuit.com/v3/company";

      for (const contact of enabledContacts) {
        try {
          // Find open invoices for this contact's customer/project with balance > 0
          const relatedInvoices = allInvoices.filter((inv) => {
            if (inv.orgId !== orgId) return false;
            if (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off") return false;
            if ((inv.total - (inv.paid || 0)) <= 0) return false;
            if (PAUSE_STAGES.includes(inv.collectionStage)) return false;

            // Match by projectId first, then customerId
            if (contact.projectId) return inv.projectId === contact.projectId;
            return inv.customerId === contact.customerId;
          });

          if (relatedInvoices.length === 0) continue;

          // Check which invoices fire a trigger today
          const triggeredInvoices = relatedInvoices.filter((inv) => {
            const d = daysFromDate(inv.dueDate);
            return getReminderType(d) !== null;
          });

          if (triggeredInvoices.length === 0) continue;

          // Determine the "highest priority" reminder type for this batch
          // (if multiple invoices, pick the most urgent)
          const types = triggeredInvoices.map((inv) => getReminderType(daysFromDate(inv.dueDate))!);
          const typePriority = ["final-notice", "second-notice", "first-notice", "pre-due"];
          const reminderType = typePriority.find((t) => types.includes(t)) ?? types[0];

          // Get customer/project name for subject
          let entityName = "";
          let entityRef  = "";
          if (contact.projectId) {
            const [proj] = await db.select().from(projects).where(eq(projects.id, contact.projectId)).limit(1);
            entityName = proj?.name ?? "";
            entityRef  = proj?.code ?? "";
          } else {
            const [cust] = await db.select().from(customers).where(eq(customers.id, contact.customerId)).limit(1);
            entityName = cust?.name ?? "";
            entityRef  = cust?.code ?? "";
          }

          // Build invoice reference string for subject
          const invRefs = triggeredInvoices.map((inv) => inv.invoiceNumber).join(", ");

          // Subject: "Payment Reminder | PROJECT-CODE | Ref: INV-001, INV-002"
          const subjectParts = [REMINDER_SUBJECTS[reminderType]];
          if (entityRef) subjectParts.push(entityRef);
          subjectParts.push(`Ref: ${invRefs}`);
          const subject = subjectParts.join(" | ");

          // Build invoice lines for body
          const invoiceLines = triggeredInvoices.map((inv) => {
            const balance = inv.total - (inv.paid || 0);
            const d = daysFromDate(inv.dueDate);
            const overdueStr = d > 0 ? `${d} days overdue` : d === 0 ? "due today" : `due ${Math.abs(d)} days`;
            return `  • ${inv.invoiceNumber} — Balance: ${balance.toLocaleString("en-IE", { style: "currency", currency: inv.currency || "EUR" })} (${overdueStr})`;
          });

          const greeting = contact.name?.split(" ")[0] || "Sir/Madam";
          const bodyFn = REMINDER_BODIES[reminderType];
          const body = bodyFn(greeting, invoiceLines);

          // Fetch PDFs for triggered invoices
          const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
          if (qboToken) {
            for (const inv of triggeredInvoices) {
              if (!inv.qboId || inv.qboId.startsWith("CM-")) continue;
              try {
                const pdfRes = await fetch(
                  `${QBO_API}/${qboToken.realmId}/invoice/${inv.qboId}/pdf?minorversion=65`,
                  { headers: { Authorization: `Bearer ${qboToken.accessToken}`, Accept: "application/pdf" } }
                );
                if (pdfRes.ok) {
                  const buf = Buffer.from(await pdfRes.arrayBuffer());
                  if (buf.byteLength > 0) {
                    attachments.push({
                      filename: `Invoice-${inv.invoiceNumber}.pdf`,
                      content: buf,
                      contentType: "application/pdf",
                    });
                  }
                }
              } catch {
                // PDF fetch failure is non-fatal — send email without attachment
              }
            }
          }

          await transporter.sendMail({
            from,
            to: contact.email!,
            bcc: smtp.fromEmail || undefined,
            subject,
            text: body,
            html: body.replace(/\n/g, "<br>"),
            attachments: attachments.length > 0 ? attachments : undefined,
          });

          remindersSent++;
        } catch (contactErr: any) {
          reminderErrors.push(`Contact ${contact.email}: ${contactErr.message}`);
        }
      }
    } catch (orgErr: any) {
      reminderErrors.push(`Org ${orgId}: ${orgErr.message}`);
    }
  }

  return NextResponse.json({
    ran: today,
    escalated,
    remindersSent,
    errors: reminderErrors.length > 0 ? reminderErrors : undefined,
  });
}
