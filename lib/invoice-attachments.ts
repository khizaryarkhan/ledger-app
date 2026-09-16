/**
 * Fetch invoice PDFs from the provider as email attachments.
 *
 * Extracted verbatim from app/api/email/send/route.ts so the route and the
 * background bulk sender (lib/batch/send-chunk-runner.ts) share ONE
 * implementation. CLAUDE.md records what happens otherwise: commit-runner.ts
 * kept its own inline copy of commitOneDoc's logic and went on shipping the
 * bug that had already been fixed in the shared one.
 */

import { db } from "@/db";
import { invoices } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getOrgXeroToken } from "@/lib/xero-token";
import { getOrgQboToken, stampQboPayButton } from "@/lib/qbo-token";

const XERO_API = "https://api.xero.com/api.xro/2.0";
const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

export type MailAttachment = { filename: string; content: Buffer; contentType: string };

/** Total attachment bytes most providers will accept. */
export const MAX_ATTACHMENT_BYTES = 24 * 1024 * 1024;

export async function fetchInvoicePdfAttachments(
  orgId: string, invoiceIds: string[],
): Promise<{ attachments: MailAttachment[]; errors: string[] }> {
  const attachments: MailAttachment[] = [];
  const errors: string[] = [];
  if (!invoiceIds.length) return { attachments, errors };

  const invRows = await Promise.all(invoiceIds.map(id =>
    db.select().from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.orgId, orgId)))
      .limit(1).then(r => r[0] ?? null)));

  const isClosedOrPaid = (inv: any) =>
    ["Paid", "Written Off"].includes(inv.paymentStatus ?? "") || inv.collectionStage === "Closed";

  const needsXero = invRows.some(inv => inv && inv.xeroId && !inv.xeroId.startsWith("CN-") && !isClosedOrPaid(inv));
  const needsQbo = invRows.some(inv => inv && inv.qboId && !inv.qboId.startsWith("CM-") && !inv.xeroId && !isClosedOrPaid(inv));

  const [xeroToken, qboToken] = await Promise.all([
    needsXero ? getOrgXeroToken(orgId).catch(() => null) : Promise.resolve(null),
    needsQbo ? getOrgQboToken(orgId).catch(() => null) : Promise.resolve(null),
  ]);

  const results = await Promise.allSettled<MailAttachment | null>(invRows.map(async inv => {
    if (!inv) return null;

    if (inv.xeroId && !inv.xeroId.startsWith("CN-")) {
      if (isClosedOrPaid(inv)) return null;
      if (!xeroToken) throw new Error("Xero not connected — could not fetch PDF");
      const res = await fetch(`${XERO_API}/Invoices/${inv.xeroId}`, {
        headers: {
          Authorization: `Bearer ${xeroToken.accessToken}`,
          "Xero-Tenant-Id": xeroToken.tenantId,
          Accept: "application/pdf",
        },
      });
      if (!res.ok) {
        console.error(`Xero PDF fetch failed for ${inv.invoiceNumber}: HTTP ${res.status} — ${await res.text()}`);
        throw new Error(`PDF unavailable for invoice ${inv.invoiceNumber} (Xero error ${res.status})`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.byteLength) throw new Error(`Empty PDF returned for invoice ${inv.invoiceNumber}`);
      return { filename: `Invoice-${inv.invoiceNumber}.pdf`, content: buf, contentType: "application/pdf" };
    }

    if (!inv.qboId || inv.qboId.startsWith("CM-") || isClosedOrPaid(inv)) return null;
    if (!qboToken) throw new Error("QuickBooks not connected — could not fetch PDFs");
    const res = await fetch(
      `${QBO_API}/${qboToken.realmId}/invoice/${inv.qboId}/pdf?minorversion=65`,
      { headers: { Authorization: `Bearer ${qboToken.accessToken}`, Accept: "application/pdf" } });
    if (!res.ok) {
      console.error(`QBO PDF fetch failed for ${inv.invoiceNumber}: HTTP ${res.status} — ${await res.text()}`);
      throw new Error(`PDF unavailable for invoice ${inv.invoiceNumber} (QBO error ${res.status})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.byteLength) throw new Error(`Empty PDF returned for invoice ${inv.invoiceNumber}`);
    const stamped = await stampQboPayButton(orgId, { qboId: inv.qboId, invoiceNumber: inv.invoiceNumber }, buf);
    return { filename: `Invoice-${inv.invoiceNumber}.pdf`, content: stamped, contentType: "application/pdf" };
  }));

  for (const r of results) {
    if (r.status === "fulfilled" && r.value) attachments.push(r.value);
    else if (r.status === "rejected") errors.push((r.reason as Error)?.message ?? "PDF fetch failed");
  }
  return { attachments, errors };
}
