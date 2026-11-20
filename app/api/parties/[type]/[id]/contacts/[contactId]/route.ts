/**
 * PATCH  /api/parties/suppliers/[id]/contacts/[contactId]
 * DELETE /api/parties/suppliers/[id]/contacts/[contactId]
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { updateContact, deleteContact, contactErrorOf } from "@/lib/party-contacts-server";

type P = { params: { type: string; id: string; contactId: string } };
const isAdmin = (role?: string | null) => ["company_admin", "super_admin"].includes(role ?? "");

async function guard(params: P["params"]) {
  const r = await requireOrg();
  if (r.error) return { res: r.error };
  if (params.type !== "suppliers") return { res: bad("Contacts here are kept for suppliers only", 404) };
  if (!isAdmin(r.role)) return { res: bad("Admins only", 403) };
  return { orgId: r.orgId! };
}

export async function PATCH(req: Request, { params }: P) {
  const g = await guard(params);
  if ("res" in g) return g.res;
  const b = await req.json().catch(() => ({}));
  try {
    return ok(await updateContact(g.orgId, params.id, params.contactId, b));
  } catch (e) {
    const c = contactErrorOf(e);
    if (c) return bad(c.message, c.status);
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: P) {
  const g = await guard(params);
  if ("res" in g) return g.res;
  try {
    await deleteContact(g.orgId, params.id, params.contactId);
    return ok({ id: params.contactId, deleted: true });
  } catch (e) {
    const c = contactErrorOf(e);
    if (c) return bad(c.message, c.status);
    throw e;
  }
}
