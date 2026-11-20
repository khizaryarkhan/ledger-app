/**
 * GET  /api/parties/suppliers/[id]/contacts  → the supplier's contacts
 * POST /api/parties/suppliers/[id]/contacts  → add one
 *
 * Suppliers only (customers keep their collections contacts). Writes are
 * admin-only, the same rule as editing a supplier. Rules: lib/party-terms.ts.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { listContacts, createContact, contactErrorOf } from "@/lib/party-contacts-server";

const isAdmin = (role?: string | null) => ["company_admin", "super_admin"].includes(role ?? "");

export async function GET(_req: Request, { params }: { params: { type: string; id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  if (params.type !== "suppliers") return bad("Contacts here are kept for suppliers only", 404);
  return ok(await listContacts(orgId!, params.id));
}

export async function POST(req: Request, { params }: { params: { type: string; id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (params.type !== "suppliers") return bad("Contacts here are kept for suppliers only", 404);
  if (!isAdmin(role)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  try {
    return ok(await createContact(orgId!, params.id, b));
  } catch (e) {
    const c = contactErrorOf(e);
    if (c) return bad(c.message, c.status);
    throw e;
  }
}
