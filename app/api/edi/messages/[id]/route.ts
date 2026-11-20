/**
 * GET   /api/edi/messages/[id]             → the message with its payload
 * GET   /api/edi/messages/[id]?download=1  → the file itself, to deliver to the partner
 * PATCH /api/edi/messages/[id] { action: "sent" } | { action: "void", reason } | { action: "reprocess" } (an inbound file that failed)
 *                               | { action: "bill", index, taxRateId? } (a person creates the bill an 810 proposes)
 *                               | { action: "ack" } (our 997 for a received file, kept to download and mark sent)
 */
import { ok, bad, requireOrg } from "@/lib/api";
import { getMessage, markMessageSent, voidMessage } from "@/lib/edi/edi-server";
import { reprocessMessage, generateAck997 } from "@/lib/edi/inbound-server";
import { createBillFromEdiInvoice } from "@/lib/accounting/edi-bill-server";
import { requireModule } from "@/lib/modules-server";
import { LedgerValidationError } from "@/lib/ledger";
import { ediGuard, ediFail } from "../../_shared";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await ediGuard(await requireOrg(), "read");
  if (g.error) return g.error;
  try {
    const m = await getMessage(g.orgId!, params.id);
    if (new URL(req.url).searchParams.get("download") === "1") {
      return new Response(m.payload, { headers: {
        "Content-Type": "application/edi-x12; charset=us-ascii",
        "Content-Disposition": `attachment; filename="${m.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "Cache-Control": "no-store",
      } });
    }
    return ok(m);
  } catch (e) { return ediFail(e); }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await ediGuard(await requireOrg(), "operate");
  if (g.error) return g.error;
  const b = await req.json().catch(() => ({}));
  try {
    if (b?.action === "sent") return ok(await markMessageSent(g.orgId!, params.id, g.actorId));
    if (b?.action === "void") return ok(await voidMessage(g.orgId!, params.id, String(b.reason ?? ""), g.actorId));
    if (b?.action === "reprocess") return ok(await reprocessMessage(g.orgId!, params.id, g.actorId));
    if (b?.action === "ack") return ok(await generateAck997(g.orgId!, params.id, g.actorId));
    if (b?.action === "bill") {
      // A bill from receipts: the receipts live in Manufacturing, as on the Receiving screen.
      const { error: modErr } = await requireModule(g.orgId!, "manufacturing");
      if (modErr) return modErr;
      const index = Number(b.index);
      if (!Number.isInteger(index) || index < 0) return bad("index must be the invoice's position in the file's result");
      try {
        return ok(await createBillFromEdiInvoice(g.orgId!, params.id, index, b.taxRateId ? String(b.taxRateId) : null, g.actorId));
      } catch (e) {
        if (e instanceof LedgerValidationError) return bad(e.message);
        throw e;
      }
    }
    return bad("action must be sent, void, reprocess, ack or bill");
  } catch (e) { return ediFail(e); }
}
