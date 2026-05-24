/**
 * Unified email send endpoint — used by EmailComposer and any other UI surface.
 *
 * Routes through: Gmail OAuth → Microsoft OAuth → SMTP
 * (whichever transport is configured for the org).
 *
 * POST /api/email/send
 * Body: { to, subject, body, cc?, replyTo?, attachInvoiceIds? }
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { z } from "zod";
import { db } from "@/db";
import { invoices, qboTokens } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "@/lib/mailer";

// CRLF injection guard — email headers must never contain bare CR or LF
const noCRLF = z.string().regex(/^[^\r\n]*$/, "Value must not contain line breaks");

const Schema = z.object({
  to:                noCRLF.min(1).max(500),
  subject:           noCRLF.min(1).max(998),  // RFC 5322 max header line length
  body:              z.string().min(1).max(200_000),
  cc:                noCRLF.max(500).optional(),
  replyTo:           noCRLF.max(500).optional(),
  attachInvoiceIds:  z.array(z.string()).optional(),
});

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

async function getOrgToken(orgId: string) {
  const [token] = await db.select().from(qboTokens).where(eq(qboTokens.orgId, orgId)).limit(1);
  if (!token) return null;
  const now = Date.now();
  if (new Date(token.accessTokenExpiresAt).getTime() - now < 5 * 60 * 1000) {
    const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refreshToken }),
    });
    if (!res.ok) return token;
    const d = await res.json();
    await db.update(qboTokens).set({
      accessToken:          d.access_token,
      refreshToken:         d.refresh_token || token.refreshToken,
      accessTokenExpiresAt: new Date(now + (d.expires_in || 3600) * 1000),
      updatedAt:            new Date(),
    }).where(eq(qboTokens.orgId, orgId));
    return { ...token, accessToken: d.access_token };
  }
  return token;
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  try {
    const data = Schema.parse(await req.json());

    // Fetch PDFs for any requested invoice attachments
    const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
    const attachmentErrors: string[] = [];

    if (data.attachInvoiceIds && data.attachInvoiceIds.length > 0) {
      const qboToken = await getOrgToken(orgId!);
      if (!qboToken) {
        attachmentErrors.push("QuickBooks not connected — could not fetch PDFs");
      } else {
        for (const invId of data.attachInvoiceIds) {
          const [inv] = await db
            .select()
            .from(invoices)
            .where(and(eq(invoices.id, invId), eq(invoices.orgId, orgId!)))
            .limit(1);
          if (!inv) { attachmentErrors.push(`Invoice not found: ${invId}`); continue; }
          if (!inv.qboId || inv.qboId.startsWith("CM-")) continue; // credit memos have no PDF

          // QBO returns 400 for Written Off / Paid / Closed invoices — skip silently
          const isClosedOrPaid =
            ["Paid", "Written Off"].includes(inv.paymentStatus ?? "") ||
            inv.collectionStage === "Closed";
          if (isClosedOrPaid) continue;

          try {
            const pdfRes = await fetch(
              `${QBO_API}/${qboToken.realmId}/invoice/${inv.qboId}/pdf?minorversion=65`,
              { headers: { Authorization: `Bearer ${qboToken.accessToken}`, Accept: "application/pdf" } },
            );
            if (pdfRes.ok) {
              const buf = Buffer.from(await pdfRes.arrayBuffer());
              if (buf.byteLength > 0) {
                attachments.push({
                  filename:    `Invoice-${inv.invoiceNumber}.pdf`,
                  content:     buf,
                  contentType: "application/pdf",
                });
              } else {
                attachmentErrors.push(`Empty PDF returned for invoice ${inv.invoiceNumber}`);
              }
            } else {
              const errText = await pdfRes.text();
              console.error(`QBO PDF fetch failed for invoice ${inv.invoiceNumber} (qboId: ${inv.qboId}): HTTP ${pdfRes.status} — ${errText}`);
              attachmentErrors.push(`PDF unavailable for invoice ${inv.invoiceNumber} (QBO error ${pdfRes.status})`);
            }
          } catch (e: any) {
            console.error(`PDF fetch exception for ${inv.invoiceNumber}:`, e);
            attachmentErrors.push(`PDF fetch failed for invoice ${inv.invoiceNumber}: ${e.message}`);
          }
        }
      }
    }

    // Send via whichever transport is configured (Gmail → Microsoft → SMTP)
    const result = await sendEmail(orgId!, {
      to:          data.to,
      subject:     data.subject,
      body:        data.body,
      cc:          data.cc,
      replyTo:     data.replyTo,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    return ok({
      sent:             true,
      transport:        result.transport,
      from:             result.from,
      attachments:      attachments.map(a => a.filename),
      attachmentErrors,
    });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error("Email send error:", e);
    return bad(e.message || "Failed to send email", 500);
  }
}
