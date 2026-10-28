/**
 * PATCH /api/trade-documents/[kind]/[id]/confirm → record the counterparty's
 * confirmation of a PO / SO: their reference, promised delivery date (header
 * or per line), and sent / confirmed status (0114). Changes no quantity or
 * money, so — like receiving — any company user may record it.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { confirmTradeDoc } from "@/lib/accounting/trade-documents";
import { LedgerValidationError } from "@/lib/ledger";

export async function PATCH(req: Request, { params }: { params: { kind: string; id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  if (params.kind !== "purchase-orders" && params.kind !== "sales-orders") return bad("Only purchase and sales orders are confirmed.", 404);
  const body = await req.json().catch(() => ({}));
  const lines = Array.isArray(body.lines)
    ? body.lines.filter((l: any) => typeof l?.lineId === "string").map((l: any) => ({ lineId: l.lineId, promisedDate: typeof l.promisedDate === "string" ? l.promisedDate : null }))
    : undefined;
  try {
    return ok(await confirmTradeDoc(orgId!, params.id, {
      partyRef: typeof body.partyRef === "string" || body.partyRef === null ? body.partyRef : undefined,
      promisedDate: typeof body.promisedDate === "string" || body.promisedDate === null ? body.promisedDate : undefined,
      lines,
      markSent: body.markSent === true,
      confirmed: typeof body.confirmed === "boolean" ? body.confirmed : undefined,
    }, (session?.user as any)?.id ?? null));
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[trade-documents] confirm failed:", e);
    return bad("Could not save the confirmation", 500);
  }
}
