/**
 * GET  /api/edi/invoices/[id] → { partner, problems, messages }: can this invoice go by EDI (810), and what was sent
 * POST /api/edi/invoices/[id] → generate its X12 810 and keep it; 422 { problems } names what stops it
 *
 * [id] is the invoice's journal entry id (what /accounting/transactions/[id] is keyed by).
 * Delivery is manual: download the file, deliver it, then mark it sent (/api/edi/messages/[id]).
 */
import { ok, requireOrg } from "@/lib/api";
import { checkInvoice810, generateInvoice810 } from "@/lib/edi/outbound-server";
import { ediGuard, ediFail } from "../../_shared";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const g = await ediGuard(await requireOrg(), "read");
  if (g.error) return g.error;
  try { return ok(await checkInvoice810(g.orgId!, params.id)); } catch (e) { return ediFail(e); }
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const g = await ediGuard(await requireOrg(), "operate");
  if (g.error) return g.error;
  try { return ok(await generateInvoice810(g.orgId!, params.id, g.actorId)); } catch (e) { return ediFail(e); }
}
