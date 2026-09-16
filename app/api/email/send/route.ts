/**
 * Unified email send endpoint — used by EmailComposer and any other UI surface.
 *
 * Routes through: Gmail OAuth → Microsoft OAuth → SMTP
 * (whichever transport is configured for the org).
 *
 * POST /api/email/send
 * Body: { to, subject, body, cc?, replyTo?, attachInvoiceIds? }
 */

import { requireReadScope, ok, bad } from "@/lib/api";
import { z } from "zod";
import { db } from "@/db";
import { invoices, communications } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { sendEmail } from "@/lib/mailer";
import { getOrgXeroToken } from "@/lib/xero-token";
import { getOrgQboToken, stampQboPayButton, fetchQboInvoiceLink } from "@/lib/qbo-token";
import { appendPayButton } from "@/lib/ar-email";
import { fetchInvoicePdfAttachments, MAX_ATTACHMENT_BYTES } from "@/lib/invoice-attachments";

const XERO_API = "https://api.xero.com/api.xro/2.0";

// CRLF injection guard — email headers must never contain bare CR or LF
const noCRLF = z.string().regex(/^[^\r\n]*$/, "Value must not contain line breaks");

const Schema = z.object({
  to:                  noCRLF.min(1).max(500),
  subject:             noCRLF.min(1).max(998),  // RFC 5322 max header line length
  body:                z.string().min(1).max(200_000),
  cc:                  noCRLF.max(500).optional(),
  replyTo:             noCRLF.max(500).optional(),
  invoiceId:           z.string().uuid().optional(),
  orgId:               z.string().uuid().optional(), // target branch for a customer-level email (no invoice)
  inReplyToOverride:   z.string().max(998).optional(),
  attachInvoiceIds:    z.array(z.string()).optional(),
  // Client-generated attachments (e.g. the Statement of Open Invoices PDF,
  // built with the same lib the export uses so it's byte-identical). Base64.
  extraAttachments:    z.array(z.object({
    filename:      noCRLF.min(1).max(255),
    contentBase64: z.string().min(1).max(28_000_000), // ~20MB decoded
    contentType:   z.string().max(128).optional(),
  })).max(5).optional(),
});

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

export async function POST(req: Request) {
  const { error, orgId: actingOrg, orgIds } = await requireReadScope();
  if (error) return error;

  try {
    const data = Schema.parse(await req.json());

    // Per-branch identity: an email about a branch's invoice must send from THAT
    // branch's connected mailbox — never the acting (Head-Office) user's org.
    // Resolve the target org from the invoice (authoritative), or an explicit
    // orgId for a customer-level email, else the acting org. Then authorise the
    // sender for it: their own org, or any branch in an active group they hold.
    let targetOrg = actingOrg!;
    if (data.invoiceId) {
      const [inv] = await db.select({ orgId: invoices.orgId }).from(invoices).where(eq(invoices.id, data.invoiceId)).limit(1);
      if (!inv) return bad("Invoice not found", 404);
      targetOrg = inv.orgId;
    } else if (data.orgId) {
      targetOrg = data.orgId;
    }
    const allowed = new Set<string>([actingOrg!, ...orgIds]);
    if (!allowed.has(targetOrg)) return bad("You don't have access to that branch's mailbox", 403);

    // Invoice PDFs — shared with the background bulk sender.
    const { attachments, errors: attachmentErrors } =
      await fetchInvoicePdfAttachments(targetOrg, data.attachInvoiceIds ?? []);

    // Client-provided attachments (statement PDF, etc.).
    if (data.extraAttachments?.length) {
      for (const a of data.extraAttachments) {
        const content = Buffer.from(a.contentBase64, "base64");
        if (content.byteLength) attachments.push({ filename: a.filename, content, contentType: a.contentType || "application/pdf" });
      }
    }

    // Guard total attachment size (most providers reject > ~25MB).
    const totalBytes = attachments.reduce((s, a) => s + a.content.byteLength, 0);
    if (totalBytes > MAX_ATTACHMENT_BYTES) return bad("Attachments exceed 24MB — reduce the selection or send without invoice PDFs");

    // Determine In-Reply-To: explicit override (user clicked Reply on a specific message)
    // takes precedence over the automatic last-outbound lookup.
    let inReplyTo: string | undefined = data.inReplyToOverride;
    if (!inReplyTo && data.invoiceId) {
      const [prev] = await db
        .select({ messageId: communications.messageId })
        .from(communications)
        .where(and(
          eq(communications.orgId, targetOrg),
          eq(communications.invoiceId, data.invoiceId),
          eq(communications.direction, "Outbound"),
          eq(communications.channel, "Email"),
        ))
        .orderBy(desc(communications.sentAt))
        .limit(1);
      if (prev?.messageId) inReplyTo = prev.messageId;
    }

    // Make sure a single-invoice email carries QBO's "Pay now" button even when
    // the caller composed the body itself. The free-text composer
    // (components/feature.tsx's EmailComposer) sends whatever the user typed —
    // no branded table, so no pay button — which is why an invoice emailed that
    // way arrived with the link only on the PDF attachment. Bodies that already
    // include the link (the branded senders, which render their own per-row
    // buttons) are left alone, so nobody gets two buttons.
    let finalBody = data.body;
    if (data.invoiceId) {
      const [inv] = await db
        .select({ qboId: invoices.qboId, xeroId: invoices.xeroId, invoiceNumber: invoices.invoiceNumber })
        .from(invoices).where(and(eq(invoices.id, data.invoiceId), eq(invoices.orgId, targetOrg))).limit(1);
      const payable = inv?.qboId && !inv.qboId.startsWith("CM-") && !(inv.xeroId && !inv.xeroId.startsWith("CN-"));
      if (payable) {
        const payUrl = await fetchQboInvoiceLink(targetOrg, inv).catch(() => null);
        // appendPayButton owns the dedup rule (lib/ar-email.ts) so it is unit
        // tested — a body that already carries the link is left alone.
        finalBody = appendPayButton(finalBody, payUrl, inv.invoiceNumber);
      }
    }

    // Send via whichever transport is configured (Gmail → Microsoft → SMTP)
    const result = await sendEmail(targetOrg, {
      to:          data.to,
      subject:     data.subject,
      body:        finalBody,
      cc:          data.cc,
      replyTo:     data.replyTo,
      inReplyTo,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    return ok({
      sent:             true,
      transport:        result.transport,
      from:             result.from,
      messageId:        result.messageId,
      attachments:      attachments.map(a => a.filename),
      attachmentErrors,
    });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error("Email send error:", e);
    return bad(e.message || "Failed to send email", 500);
  }
}
