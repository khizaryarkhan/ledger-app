import { db } from "@/db";
import { invoices } from "@/db/schema";
import { requireReadScope, ok } from "@/lib/api";
import { getRepScope } from "@/lib/rep-scope";
import { desc, and, inArray, isNull } from "drizzle-orm";

// Read-only on purpose. Invoices are created through postDocument
// (/api/documents/Invoice), which posts to the ledger and bridges the row in;
// a plain insert here would create a receivable with no journal entry.
export async function GET() {
  // Group mode → all branches' invoices; else the single active org.
  const { error, orgId, orgIds, role, repId } = await requireReadScope();
  if (error) return error;

  // Soft-deleted invoices (deleted in QuickBooks) are hidden everywhere. This
  // endpoint backs the invoice list, Collections Board and dashboard via
  // data-provider, so excluding here covers all of them at once.
  const rows = await db.select().from(invoices)
    .where(and(inArray(invoices.orgId, orgIds), isNull(invoices.deletedAt)))
    .orderBy(desc(invoices.dueDate));

  // Reps only see invoices in their book of business; admins/accountants see all.
  const scope = await getRepScope(orgId!, role, repId);
  if (scope) return ok(rows.filter((i) => scope.invoiceIds.has(i.id)));
  return ok(rows);
}
