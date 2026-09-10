/**
 * POST /api/invoices/pay-links   { invoiceIds: string[] }
 *   → { links: { [invoiceId]: string | null } }
 *
 * Bulk sibling of GET /api/invoices/[id]/pay-link, for the email senders that
 * render the branded template CLIENT-side (components/send-invoices-modal.tsx
 * and the bulk sender in components/feature.tsx). Those run in the browser,
 * where there's no QBO token — which is exactly why "Pay now" buttons were
 * missing from emails sent that way even though the server-stamped PDF
 * attachment had one. Same shape as the portal-token fetch those components
 * already do before rendering.
 *
 * Missing/ineligible invoices simply map to null — a missing pay button must
 * never block an email from going out.
 */

import { db } from "@/db";
import { invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, inArray } from "drizzle-orm";
import { isInvoiceInScope } from "@/lib/receivables/rep-scope";
import { fetchQboInvoiceLink } from "@/lib/qbo-token";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const invoiceIds: unknown = body?.invoiceIds;
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) return bad("invoiceIds required");
  if (invoiceIds.length > 50) return bad("Maximum 50 invoices at a time");

  const ids = invoiceIds.filter((v): v is string => typeof v === "string");

  const rows = await db
    .select({ id: invoices.id, qboId: invoices.qboId, xeroId: invoices.xeroId, invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId!), inArray(invoices.id, ids)));

  const userId = (session?.user as any)?.id ?? null;
  const links: Record<string, string | null> = {};

  await Promise.all(
    rows.map(async (inv) => {
      links[inv.id] = null;
      // A rep must not be able to pull links for another rep's customers.
      if (!(await isInvoiceInScope(orgId!, userId, inv.id))) return;
      if (!inv.qboId || inv.qboId.startsWith("CM-")) return;
      if (inv.xeroId && !inv.xeroId.startsWith("CN-")) return;
      links[inv.id] = await fetchQboInvoiceLink(orgId!, inv).catch(() => null);
    }),
  );

  return ok({ links });
}
