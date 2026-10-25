/**
 * Recurring document generation — QBO form-parity, Phase 6 "Make Recurring".
 * Mirrors inngest/functions/chase.ts's own two-function shape exactly: a
 * cron scheduler fans out one event per org, a per-org handler processes it
 * in isolation (retried independently, each template wrapped in step.run so
 * a failed one doesn't block the rest of the org or get regenerated on retry).
 */
import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { organisations, recurringTemplates } from "@/db/schema";
import { eq, and, lte } from "drizzle-orm";
import { postDocument } from "@/lib/accounting/documents";
import { nextOccurrence, isTemplateFinished } from "@/lib/accounting/recurring";
import { today } from "@/lib/format";
import { requireActiveSubscription } from "@/lib/billing";
import { sendEmail, hasEmailTransport } from "@/lib/mailer";
import { loadLedgerDocumentForPrint } from "@/lib/accounting/document-print";
import { renderLedgerDocumentPdf } from "@/lib/pdf/document-pdf";

export const recurringDocScheduler = inngest.createFunction(
  { id: "recurring-doc-scheduler", triggers: [{ cron: "0 6 * * *" }] },
  async ({ step }) => {
    const orgs = await step.run("fetch-orgs", () =>
      db.select({ id: organisations.id }).from(organisations),
    );
    if (orgs.length === 0) return { queued: 0 };
    await inngest.send(orgs.map(org => ({ name: "document/process-recurring" as const, data: { orgId: org.id } })));
    return { queued: orgs.length };
  },
);

export const processOrgRecurring = inngest.createFunction(
  { id: "process-org-recurring", retries: 2, triggers: [{ event: "document/process-recurring" }] },
  async ({ event, step }) => {
    const { orgId } = event.data;
    const todayStr = today();

    const { access } = await step.run("check-subscription", () => requireActiveSubscription(orgId)) as { access: string };
    if (access === "blocked" || access === "readonly") return { orgId, skipped: 1, reason: `subscription-${access}` };

    const due = await step.run("fetch-due-templates", () =>
      db.select().from(recurringTemplates)
        .where(and(eq(recurringTemplates.orgId, orgId), eq(recurringTemplates.active, true), lte(recurringTemplates.nextRunDate, todayStr))),
    );
    if (due.length === 0) return { orgId, generated: 0 };

    let generated = 0;
    const errors: string[] = [];

    for (const tpl of due) {
      await step.run(`generate-${tpl.id}-${tpl.nextRunDate}`, async () => {
        try {
          const entry = await postDocument(orgId, { ...(tpl.payload as any), date: tpl.nextRunDate }, tpl.createdBy);
          const occurrencesCreated = tpl.occurrencesCreated + 1;
          const upcomingNextRun = nextOccurrence(tpl.nextRunDate, tpl.frequency as any, tpl.interval);
          const finished = isTemplateFinished({
            endType: tpl.endType as any, endAfterCount: tpl.endAfterCount, endOnDate: tpl.endOnDate,
            occurrencesCreated, nextRunDate: upcomingNextRun,
          });
          await db.update(recurringTemplates).set({
            occurrencesCreated, nextRunDate: upcomingNextRun, active: !finished,
            lastRunAt: new Date(), lastRunEntryId: entry.id,
          }).where(eq(recurringTemplates.id, tpl.id));

          if (tpl.autoSend && entry.id && await hasEmailTransport(orgId)) {
            await sendRecurringEmail(orgId, entry.id).catch(e => console.error(`[recurring] auto-send failed for ${tpl.id}:`, e));
          }
          generated++;
        } catch (e: any) {
          console.error(`[recurring] template ${tpl.id} (${tpl.templateName}) failed:`, e);
          errors.push(`${tpl.templateName}: ${e?.message ?? "unknown error"}`);
        }
      });
    }

    return { orgId, generated, errors };
  },
);

/** Email the freshly generated document to its party, using the same
 *  defaults components/document-email-modal.tsx builds for a manual send —
 *  duplicated here deliberately rather than an HTTP round-trip to
 *  /api/email/send, since this already runs server-side with no browser. */
async function sendRecurringEmail(orgId: string, entryId: string): Promise<void> {
  const doc = await loadLedgerDocumentForPrint(orgId, entryId);
  if (!doc?.party?.email) return; // nothing to send to — not an error, just nothing to do
  const companyName = doc.company?.name || "";
  const docLabel = (doc.doc.label || "Document").replace(/\b\w/g, c => c.toUpperCase());
  const subject = `${docLabel}${doc.doc.docNumber ? ` ${doc.doc.docNumber}` : ""}${companyName ? ` from ${companyName}` : ""}`;
  const greeting = doc.party.name ? `Hi ${doc.party.name.split(" ")[0]},` : "Hi,";
  const body = `${greeting}\n\nPlease find attached ${docLabel.toLowerCase()}${doc.doc.docNumber ? ` ${doc.doc.docNumber}` : ""}.\n\nKind regards,\n${companyName}`;
  const pdf = await renderLedgerDocumentPdf(orgId, entryId);
  await sendEmail(orgId, {
    to: doc.party.email, subject, body,
    attachments: pdf ? [{ filename: `${docLabel}${doc.doc.docNumber ? `-${doc.doc.docNumber}` : ""}.pdf`, content: Buffer.from(pdf), contentType: "application/pdf" }] : undefined,
  });
}
