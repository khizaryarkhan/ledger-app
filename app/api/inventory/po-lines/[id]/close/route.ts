/**
 * POST /api/inventory/po-lines/[id]/close
 *
 * Manually closes a Purchase Order line's remaining-to-receive quantity — for
 * when a supplier will never deliver the rest of what was ordered. A reason
 * is required: this is a buyer giving up on part of an order, not a routine
 * action, and it's worth a record on the PO.
 *
 * Does not touch orderedBaseQty/receivedQty — po-open treats a closed line's
 * remainingQty as 0, but what was actually ordered and received stays true.
 */
import { db } from "@/db";
import { tradeDocumentLines, tradeDocuments } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq } from "drizzle-orm";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;

  const b = await req.json().catch(() => ({}));
  const reason = String(b?.reason ?? "").trim();
  if (!reason) return bad("A reason is required to close a line with quantity still outstanding.");

  const [line] = await db.select().from(tradeDocumentLines)
    .where(and(eq(tradeDocumentLines.id, params.id), eq(tradeDocumentLines.orgId, orgId!))).limit(1);
  if (!line) return bad("Line not found", 404);
  if (line.closed) return bad("This line is already closed.");

  const [doc] = await db.select({ kind: tradeDocuments.kind }).from(tradeDocuments)
    .where(and(eq(tradeDocuments.id, line.documentId), eq(tradeDocuments.orgId, orgId!))).limit(1);
  if (!doc || doc.kind !== "PurchaseOrder") return bad("Only purchase order lines can be closed this way.");

  await db.update(tradeDocumentLines).set({ closed: true, closeReason: reason, closedAt: new Date() })
    .where(eq(tradeDocumentLines.id, params.id));
  return ok({ closed: true });
}
