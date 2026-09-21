/**
 * PATCH  /api/inventory/locations/[id]  → rename, retype, re-parent, activate/deactivate, set default
 * DELETE /api/inventory/locations/[id]  → remove, if it is empty and unused
 *
 * Master data, so admin-only — same rule as items, SKUs and BOMs.
 *
 * Tenancy: updateLocation/deleteLocation both re-read the row scoped to the
 * caller's org before touching anything, so an id belonging to another tenant
 * is "not found" rather than editable. Never add a code path here that writes
 * by id alone.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import {
  updateLocation, deleteLocation, stockHeldAt, LocationError,
} from "@/lib/inventory/locations";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  const b = await req.json().catch(() => ({}));
  try {
    const row = await updateLocation(orgId!, params.id, {
      code: b?.code, name: b?.name, type: b?.type,
      parentId: b?.parentId,
      inventoryAccountId: b?.inventoryAccountId,
      address: b?.address, note: b?.note,
      status: b?.status, isDefault: b?.isDefault,
    });
    return ok(row);
  } catch (e: any) {
    if (e instanceof LocationError) return bad(e.message);
    console.error("[locations] update failed:", e);
    return bad("Failed to update the location", 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  try {
    await deleteLocation(orgId!, params.id);
    return ok({ deleted: true });
  } catch (e: any) {
    if (e instanceof LocationError) {
      // Include what is actually in the way, so the message is actionable
      // rather than just a refusal.
      const held = await stockHeldAt(orgId!, params.id).catch(() => 0);
      return bad(held > 0 ? `${e.message}` : e.message);
    }
    console.error("[locations] delete failed:", e);
    return bad("Failed to delete the location", 500);
  }
}
