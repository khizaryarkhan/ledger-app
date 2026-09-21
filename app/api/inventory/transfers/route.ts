/**
 * GET  /api/inventory/transfers  → the transfer register
 * POST /api/inventory/transfers  → move stock between locations
 *
 * Posting a transfer is a FLOOR operation — a storeman physically carries
 * stock from one place to another — so it needs canPostInventoryTxn, not admin.
 * That is the same reasoning that lets floor staff post goods receipts,
 * shipments and production builds while keeping money documents admin-only.
 * A transfer creates no payable and no receivable: it moves nothing but
 * placement, and at most reclassifies between two balance-sheet accounts.
 */

import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { postStockTransfer, listStockTransfers, type TransferInput } from "@/lib/inventory/transfers";
import { LedgerValidationError } from "@/lib/ledger";
import { LocationError } from "@/lib/inventory/locations";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;

  const url = new URL(req.url);
  const rows = await listStockTransfers(orgId!, {
    limit: Number(url.searchParams.get("limit")) || 100,
    locationId: url.searchParams.get("locationId"),
  });
  return ok(rows.map(r => ({ ...r, totalCost: Number(r.totalCost ?? 0) })));
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission to move stock", 403);

  const body = (await req.json().catch(() => ({}))) as TransferInput;
  try {
    const res = await postStockTransfer(orgId!, body, (session?.user as any)?.id ?? null);
    return ok(res);
  } catch (e: any) {
    // Both are "the user asked for something that isn't valid", not a server
    // fault — return the sentence rather than a generic 500.
    if (e instanceof LedgerValidationError || e instanceof LocationError) return bad(e.message);
    console.error("[transfers] post failed:", e);
    return bad("Failed to post the stock transfer", 500);
  }
}
