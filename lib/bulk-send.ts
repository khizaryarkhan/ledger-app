/**
 * Bulk "send invoices" — the server side.
 *
 * TWO PROBLEMS THIS SOLVES, and they are separate.
 *
 * 1. SAFETY. Grouping by email domain once put 185 unrelated customers on one
 *    email with all their addresses in To: (see lib/send-grouping.ts). That was
 *    fixed in the modal, which made the UI safe but left the invariant living
 *    in a React component — anything posting to /api/email/send directly could
 *    still blast everyone. The grouping is now recomputed HERE, from the
 *    database, and the browser cannot widen it: it may only ask for merges the
 *    server itself already judged legitimate.
 *
 * 2. DURABILITY. The modal sent N emails from a `for` loop in the browser.
 *    Close the tab at email 37 of 224 and it stopped — 37 delivered, no record
 *    of which. CLAUDE.md already records this exact lesson for Data Studio
 *    ("Processing is server-driven, not browser-driven"), so this reuses that
 *    engine (lib/batch/lease.ts + the Inngest chunk loop) rather than adding a
 *    third hand-rolled loop.
 */

import { db } from "@/db";
import { invoices, customers, projects, communications } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { sendEmail } from "@/lib/mailer";
import { renderInvoiceEmail } from "@/lib/ar-email";
import { buildStatementPdf } from "@/lib/statement-pdf";
import { fetchInvoicePdfAttachments, MAX_ATTACHMENT_BYTES } from "@/lib/invoice-attachments";
import { groupByCustomer, mergeCandidates, applyMerges } from "@/lib/send-grouping";
import { genEmailRef } from "@/lib/email-ref";
import { fillTemplate, greetingName } from "@/lib/email-template";
import { createPortalToken } from "@/lib/portal";
import { fetchQboInvoiceLink } from "@/lib/qbo-token";

/** One invoice as the email template needs it. Plain JSON — it is persisted in
 *  batch_jobs.input and read back by a worker in a different process. */
export type SendJobRow = {
  invoiceId: string;
  invoiceNumber: string;
  custId: string;
  custName: string;
  projName: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  bal: number;
  currency: string;
  days: number;
  email: string | null;
  qboId: string | null;
  projectId: string | null;
};

export type SendJobGroup = {
  key: string;
  label: string;
  custIds: string[];
  to: string;
  rows: SendJobRow[];
};

export type SendJobOptions = {
  subject: string;
  body: string;
  cc?: string;
  attachPdf: boolean;
  attachStatement: boolean;
  includePortal: boolean;
  orgName: string;
  logoUrl: string | null;
};

const daysOverdue = (due: string | null) =>
  due ? Math.floor((Date.now() - new Date(due).getTime()) / 86_400_000) : 0;

/**
 * Load the selected invoices and group them for sending. Org-scoped, and the
 * ONLY place a group's membership is decided.
 *
 * `requestedMerges` is intersected with the server's own mergeCandidates, so a
 * caller asking to merge "gmail.com" is simply ignored rather than trusted.
 */
export async function buildSendGroups(
  orgId: string,
  invoiceIds: string[],
  requestedMerges: string[] = [],
  toOverrides: Record<string, string> = {},
): Promise<{ groups: SendJobGroup[]; skippedNoEmail: number; notFound: number }> {
  if (!invoiceIds.length) return { groups: [], skippedNoEmail: 0, notFound: 0 };

  const invRows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      total: invoices.total,
      paid: invoices.paid,
      qboBalance: invoices.qboBalance,
      currency: invoices.currency,
      billingEmail: invoices.billingEmail,
      qboId: invoices.qboId,
      projectId: invoices.projectId,
      custId: invoices.customerId,
      custName: customers.name,
      custEmail: customers.email,
      projName: projects.name,
    })
    .from(invoices)
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .where(and(eq(invoices.orgId, orgId), inArray(invoices.id, invoiceIds)));

  const notFound = invoiceIds.length - invRows.length;

  const rows: SendJobRow[] = invRows
    .filter(r => !!r.custId)
    .map(r => ({
      invoiceId: r.id,
      invoiceNumber: r.invoiceNumber,
      custId: r.custId!,
      custName: r.custName ?? "Customer",
      projName: r.projName ?? null,
      invoiceDate: r.invoiceDate ?? null,
      dueDate: r.dueDate ?? null,
      bal: Number(r.qboBalance ?? (Number(r.total ?? 0) - Number(r.paid ?? 0))) || 0,
      currency: r.currency ?? "USD",
      days: daysOverdue(r.dueDate ?? null),
      // Same precedence the board uses: the invoice's own billing email wins,
      // then the customer's.
      email: r.billingEmail || r.custEmail || null,
      qboId: r.qboId ?? null,
      projectId: r.projectId ?? null,
    }));

  const { groups: perCustomer, noEmail } = groupByCustomer(rows);
  const candidates = mergeCandidates(perCustomer);
  const allowed = new Set(candidates.map(c => c.domain));
  const honoured = new Set(requestedMerges.filter(d => allowed.has(d)));
  const merged = applyMerges(perCustomer, honoured, candidates);

  return {
    groups: merged.map(g => ({
      key: g.key,
      label: g.label,
      custIds: g.custIds,
      to: (toOverrides[g.key] ?? g.emails.join(", ")).trim(),
      rows: g.rows,
    })),
    skippedNoEmail: noEmail.length,
    notFound,
  };
}


/** Send ONE group's email. Never throws for an expected failure — the chunk
 *  engine records `{ ok: false, error }` as a failed item and carries on. */
export async function sendGroupEmail(
  orgId: string, group: SendJobGroup, opts: SendJobOptions,
): Promise<{ ok: boolean; error?: string; messageId?: string; ref?: string }> {
  // Last line of defence. A group carrying several customers is only legitimate
  // when buildSendGroups minted it as an explicit merge; anything else means a
  // bug upstream, and the right outcome is a recorded failure, not an email.
  if (group.custIds.length > 1 && !group.key.startsWith("merge:")) {
    return { ok: false, error: "Refused: group mixes customers without an explicit merge" };
  }
  if (!group.to) return { ok: false, error: "No recipient" };
  if (!group.rows.length) return { ok: false, error: "No invoices" };

  const ref = genEmailRef();
  // {invoicelines} resolves to empty on purpose, exactly as the chase paths do:
  // the branded table under the intro already lists every invoice, so filling
  // it would print the list twice.
  const tpl = { name: greetingName(group.rows[0]?.custName), ref, invoiceLines: [] };
  const subject = fillTemplate(opts.subject, tpl);
  const intro = fillTemplate(opts.body, tpl);
  const ids = group.rows.map(r => r.invoiceId);
  const total = group.rows.reduce((s, r) => s + r.bal, 0);

  // Pay links are best-effort: no link just means no button. fetchQboInvoiceLink
  // already short-circuits for a non-QBO org and caches the org-level checks,
  // so this does not become one API call per invoice for everyone.
  const payLinks: Record<string, string | null> = Object.fromEntries(
    await Promise.all(group.rows.map(async r => [
      r.invoiceId,
      await fetchQboInvoiceLink(orgId, { qboId: r.qboId, invoiceNumber: r.invoiceNumber }).catch(() => null),
    ] as const)));

  // Customer portal link — "tell us when you'll pay / raise a query". Only
  // meaningful for a single customer, which every non-merged group now is.
  // The foreground path minted this per send; losing it here would have been a
  // silent feature regression.
  let portalUrl: string | null = null;
  if (opts.includePortal && group.custIds.length === 1) {
    try { portalUrl = (await createPortalToken(orgId, group.custIds[0], ids, null)).url; }
    catch { portalUrl = null; }
  }

  const html = renderInvoiceEmail({
    subject, dateStr: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    total, currency: group.rows[0]?.currency ?? "USD", portalUrl, intro,
    rows: group.rows.map(r => ({
      invoiceNumber: r.invoiceNumber, customerName: r.custName, projectName: r.projName,
      invoiceDate: r.invoiceDate, dueDate: r.dueDate, balance: r.bal, currency: r.currency,
      daysOverdue: r.days, payUrl: payLinks[r.invoiceId] ?? null,
    })),
  });

  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  if (opts.attachStatement) {
    try {
      const bytes = await buildStatementPdf({
        orgName: opts.orgName || "Statement of Open Invoices",
        rows: group.rows.map(r => ({
          inv: { invoiceNumber: r.invoiceNumber, invoiceDate: r.invoiceDate, dueDate: r.dueDate, currency: r.currency },
          custName: r.custName, projName: r.projName, bal: r.bal, days: r.days,
        })),
        logoUrl: opts.logoUrl,
      });
      attachments.push({ filename: "Statement-of-Open-Invoices.pdf", content: Buffer.from(bytes), contentType: "application/pdf" });
    } catch (e: any) {
      return { ok: false, error: `Couldn't build the statement PDF: ${e?.message || "unknown error"}` };
    }
  }
  if (opts.attachPdf) {
    const { attachments: pdfs, errors } = await fetchInvoicePdfAttachments(orgId, ids);
    attachments.push(...pdfs);
    // A missing invoice PDF must not cost the customer their whole email — the
    // statement still carries the detail. Recorded, not fatal.
    if (errors.length && !pdfs.length && !opts.attachStatement) {
      return { ok: false, error: errors[0] };
    }
  }
  const bytes = attachments.reduce((s, a) => s + a.content.byteLength, 0);
  if (bytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: `Attachments exceed ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB` };
  }

  let messageId: string;
  try {
    const res = await sendEmail(orgId, {
      to: group.to, cc: opts.cc || undefined, subject, body: html, attachments,
    });
    messageId = res.messageId;
  } catch (e: any) {
    return { ok: false, error: e?.message || "Send failed" };
  }

  // Log against every invoice in the email, exactly as the foreground path did.
  await Promise.all(group.rows.map(r => db.insert(communications).values({
    orgId, customerId: r.custId, invoiceId: r.invoiceId,
    projectId: r.projectId,
    direction: "Outbound", channel: "Email", subject, recipients: group.to,
    body: intro, matchedBy: "Manual", isDraft: false, refNumber: ref, messageId,
  }).catch(() => {})));

  return { ok: true, messageId, ref };
}
