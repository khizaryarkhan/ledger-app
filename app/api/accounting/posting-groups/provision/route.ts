/**
 * POST /api/accounting/posting-groups/provision  → create the default inventory
 * accounts for every role still unmapped in the default groups, and map them.
 *
 * Native tenants get this automatically on first use. For a tenant whose chart
 * is synced from QuickBooks/Xero it is the explicit "Create missing default
 * accounts" action — the accounts are created HERE only; nothing is pushed to
 * the external ledger. Idempotent: an existing mapping is never replaced.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { provisionInventoryAccounting } from "@/lib/accounting/account-roles-server";

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  return ok(await provisionInventoryAccounting(orgId!, { withAccounts: true, dryRun }));
}
