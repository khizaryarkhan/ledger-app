/**
 * PATCH  /api/accounting/posting-groups/[id]  → rename and/or remap roles
 *        body: { name?, roles?: { ROLE: accountId }, effectiveDate?, confirm? }
 *        A remap of a stock role whose old account holds value answers 409
 *        { needsConfirm, reclass[] } until it is re-sent with confirm: true,
 *        which posts the reclass entry (R-08) and saves.
 * DELETE /api/accounting/posting-groups/[id]  → delete a non-default, unused group
 */

import { db } from "@/db";
import { inventoryPostingGroups } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { updateGroupMapping, deletePostingGroup } from "@/lib/accounting/account-roles-server";
import { LedgerValidationError } from "@/lib/ledger";

const ADMIN = ["company_admin", "super_admin"];

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!ADMIN.includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const [g] = await db.select().from(inventoryPostingGroups)
    .where(and(eq(inventoryPostingGroups.id, params.id), eq(inventoryPostingGroups.orgId, orgId!))).limit(1);
  if (!g) return bad("Posting group not found", 404);

  if (typeof b?.name === "string" && b.name.trim() && b.name.trim() !== g.name) {
    const name = b.name.trim().slice(0, 128);
    const [clash] = await db.select({ id: inventoryPostingGroups.id }).from(inventoryPostingGroups)
      .where(and(eq(inventoryPostingGroups.orgId, orgId!), ne(inventoryPostingGroups.id, g.id), sql`lower(trim(${inventoryPostingGroups.name})) = ${name.toLowerCase()}`)).limit(1);
    if (clash) return bad(`A posting group called "${name}" already exists.`, 409);
    await db.update(inventoryPostingGroups).set({ name, updatedAt: new Date() }).where(eq(inventoryPostingGroups.id, g.id));
  }

  if (b?.roles && typeof b.roles === "object") {
    try {
      const r = await updateGroupMapping(orgId!, g.id, {
        roles: b.roles, confirm: !!b.confirm,
        effectiveDate: String(b.effectiveDate ?? new Date().toISOString().slice(0, 10)),
        actorId: (session?.user as any)?.id ?? null,
      });
      if ("error" in r) return bad(r.error, 409);
      if ("needsConfirm" in r) return NextResponse.json(r, { status: 409 });
      return ok(r);
    } catch (e: any) {
      if (e instanceof LedgerValidationError) return bad(e.message, 409);
      throw e;
    }
  }
  return ok({ saved: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!ADMIN.includes(role!)) return bad("Admins only", 403);
  const r = await deletePostingGroup(orgId!, params.id);
  if ("error" in r) return bad(r.error, 409);
  return ok(r);
}
