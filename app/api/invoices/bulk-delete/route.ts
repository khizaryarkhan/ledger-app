import { db } from "@/db";
import { invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { isInvoiceInScope } from "@/lib/receivables/rep-scope";
import { inArray, eq, and } from "drizzle-orm";

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  try {
    const { ids } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) return bad("No invoice IDs provided");

    // Reps may only delete invoices in their own book — ids are client-supplied,
    // so scope has to be checked per id (same per-row filter as pay-links' batch
    // lookup), not just enforced on the list views.
    const userId = (session?.user as any)?.id ?? null;
    const scoped = await Promise.all(
      ids.map(async (id: string) => ((await isInvoiceInScope(orgId!, userId, id)) ? id : null))
    );
    const allowedIds = scoped.filter((id): id is string => id !== null);
    if (allowedIds.length === 0) return bad("No matching invoices found", 404);

    await db.delete(invoices).where(and(inArray(invoices.id, allowedIds), eq(invoices.orgId, orgId!)));
    return ok({ deleted: allowedIds.length });
  } catch (e: any) {
    console.error(e);
    return bad("Failed to delete invoices", 500);
  }
}
