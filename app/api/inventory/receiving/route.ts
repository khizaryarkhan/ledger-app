/**
 * GET  /api/inventory/receiving   → list goods receipts
 * POST /api/inventory/receiving   → post a goods receipt (Dr Inventory / Cr GR/IR)
 *                                   { …, expectedDeliveryId? } marks that expected delivery received (0144)
 */

import { db } from "@/db";
import { goodsReceipts } from "@/db/schema";
import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { eq, desc } from "drizzle-orm";
import { postGoodsReceipt, type ReceiptInput } from "@/lib/inventory/receiving";
import { LedgerValidationError } from "@/lib/ledger";
import { checkDeliveryForReceipt, attachReceipt, expectedDeliveryErrorOf } from "@/lib/inventory/expected-delivery-server";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const rows = await db.select().from(goodsReceipts).where(eq(goodsReceipts.orgId, orgId!)).orderBy(desc(goodsReceipts.createdAt)).limit(200);
  return ok(rows.map(r => ({
    ...r,
    grirTotal: Number(r.grirTotal ?? 0), billedAmount: Number(r.billedAmount ?? 0),
    open: Number(r.grirTotal ?? 0) - Number(r.billedAmount ?? 0),
  })));
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission to receive stock", 403);
  const body = (await req.json().catch(() => ({}))) as ReceiptInput & { expectedDeliveryId?: string | null };
  const deliveryId = body.expectedDeliveryId ? String(body.expectedDeliveryId) : null;
  // Checked BEFORE posting, so a receipt never posts against a delivery that is then refused.
  if (deliveryId) {
    try {
      const poIds = [...new Set((body.lines ?? []).map(l => l?.poId).filter(Boolean) as string[])];
      await checkDeliveryForReceipt(orgId!, deliveryId, poIds);
    } catch (e) {
      const x = expectedDeliveryErrorOf(e);
      if (x) return bad(x.message, x.status);
      throw e;
    }
  }
  try {
    const res: any = await postGoodsReceipt(orgId!, body, (session?.user as any)?.id ?? null);
    // A receipt staged for approval has not posted: the delivery stays expected until it does.
    if (deliveryId && res?.id && !res?.pending) {
      await attachReceipt(orgId!, deliveryId, res.id).catch(e => console.error("[receiving] delivery link failed after posting", { deliveryId, e }));
    }
    return ok(res);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[receiving] post failed:", e);
    return bad("Failed to post goods receipt", 500);
  }
}
