import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireReadScope, ok } from "@/lib/api";
import { getRepScope } from "@/lib/rep-scope";
import { desc, inArray } from "drizzle-orm";

// Read-only on purpose. A customer is created and edited through PartyDrawer
// (/api/parties/customers) — one form, one set of fields, wherever it is opened.
export async function GET() {
  const { error, orgId, orgIds, role, repId } = await requireReadScope();
  if (error) return error;

  const rows = await db.select().from(customers).where(inArray(customers.orgId, orgIds)).orderBy(desc(customers.createdAt));

  // Reps only see customers in their book (plus any referenced by a visible invoice).
  const scope = await getRepScope(orgId!, role, repId);
  if (scope) return ok(rows.filter((c) => scope.customerIds.has(c.id)));
  return ok(rows);
}
