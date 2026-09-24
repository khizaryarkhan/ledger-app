/**
 * POST /api/production/mos/[id]/complete            → post one completion run
 * POST /api/production/mos/[id]/complete?preview=1  → the same numbers, nothing written
 *
 * body: { date?, outputs?: [{ skuId, goodPacks }], rejectedBase?, consume?: [{ itemId, lotId, qty }],
 *         hours?: [{ operationId, hours }], final?, outputLocationId?, notes? }
 * Every field defaults (lib/inventory/mo-completion.ts), so an empty body
 * completes the whole remainder with everything allocated.
 */

import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { completeMoRun, previewCompletion } from "@/lib/inventory/mo-completion";
import { LedgerValidationError } from "@/lib/ledger";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  const b = await req.json().catch(() => ({}));
  const preview = new URL(req.url).searchParams.get("preview") === "1";
  try {
    if (preview) return ok(await previewCompletion(orgId!, params.id, b ?? {}));
    return ok(await completeMoRun(orgId!, params.id, b ?? {}, (session?.user as any)?.id ?? null));
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[mo complete]", e);
    return bad("Could not complete MO", 500);
  }
}
