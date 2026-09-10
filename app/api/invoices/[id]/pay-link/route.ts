/**
 * GET /api/invoices/:id/pay-link
 *
 * QBO's own online-invoice "Review and pay" link for one invoice (see
 * lib/qbo-token.ts's fetchQboInvoiceLink — CLAUDE.md "AR invoice emails —
 * QBO 'Pay online' link"). Powers the "Pay online" button next to
 * "Download PDF" on the invoice detail page: the downloaded PDF itself can
 * never carry this link (QBO's PDF-export endpoint doesn't render it — that's
 * true even when the org's own accountant downloads straight from QBO), so
 * this is a separate action, not something baked into the PDF bytes.
 * Returns `{ payUrl: null }` (not an error) for Xero/native/credit-memo
 * invoices, or when QBO doesn't generate one for this invoice.
 */

import { db } from "@/db";
import { invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { isInvoiceInScope } from "@/lib/receivables/rep-scope";
import { fetchQboInvoicePayInfo } from "@/lib/qbo-token";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  if (!(await isInvoiceInScope(orgId!, (session?.user as any)?.id ?? null, params.id))) {
    return bad("Invoice not found", 404);
  }

  const [inv] = await db.select({ qboId: invoices.qboId, xeroId: invoices.xeroId, invoiceNumber: invoices.invoiceNumber })
    .from(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!))).limit(1);
  if (!inv) return bad("Invoice not found", 404);

  if (!inv.qboId || inv.qboId.startsWith("CM-") || (inv.xeroId && !inv.xeroId.startsWith("CN-"))) {
    return ok({ payUrl: null, reason: "not_qbo" });
  }

  // Reports WHICH precondition failed when there's no link, so the UI can say
  // something the admin can act on (see QboPayLinkReason in lib/qbo-token.ts).
  const info = await fetchQboInvoicePayInfo(orgId!, inv).catch(() => null);
  if (!info) return ok({ payUrl: null, reason: "lookup_failed" });
  return ok(info);
}
