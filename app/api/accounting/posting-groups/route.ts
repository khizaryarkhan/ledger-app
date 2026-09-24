/**
 * GET  /api/accounting/posting-groups  → every posting group with its role → account
 *                                        map, the accounts that may be mapped, and
 *                                        whether the org's chart is synced
 * POST /api/accounting/posting-groups  → create a group (copies the default group
 *                                        of its type)
 *
 * The mapping is accounting master data: reading is open to the org, changing
 * it is admin-only, like the chart of accounts itself.
 */

import { db } from "@/db";
import { accounts } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";
import { isGroupType, missingRoles } from "@/lib/accounting/account-roles";
import { ensureInventoryAccounting, loadGroupMaps, isSyncedOrg, createPostingGroup, groupItemCounts } from "@/lib/accounting/account-roles-server";

const ADMIN = ["company_admin", "super_admin"];

export async function GET() {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  await ensureInventoryAccounting(orgId!);
  const [groups, counts, synced, accts] = await Promise.all([
    loadGroupMaps(orgId!), groupItemCounts(orgId!), isSyncedOrg(orgId!),
    db.select({ id: accounts.id, name: accounts.name, code: accounts.code, type: accounts.type, status: accounts.status,
      isHeader: accounts.isHeader, defaultRole: accounts.defaultRole, isSystemDefault: accounts.isSystemDefault, source: accounts.source })
      .from(accounts).where(eq(accounts.orgId, orgId!)),
  ]);
  return ok({
    synced,
    canEdit: ADMIN.includes(role!),
    groups: groups
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
      .map(g => ({ ...g, itemCount: counts.get(g.id) ?? 0, missing: missingRoles(g.roles) })),
    accounts: accts.sort((a, b) => (a.code ?? "~").localeCompare(b.code ?? "~") || a.name.localeCompare(b.name)),
  });
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!ADMIN.includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  if (!isGroupType(b?.groupType)) return bad("Choose the item type this group is for.");
  const r = await createPostingGroup(orgId!, String(b?.name ?? ""), b.groupType);
  if ("error" in r) return bad(r.error, 409);
  return ok(r);
}
