import { db } from "@/db";
import { invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { inArray, eq, and } from "drizzle-orm";

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  try {
    const { ids } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) return bad("No invoice IDs provided");
    await db.delete(invoices).where(and(inArray(invoices.id, ids), eq(invoices.orgId, orgId!)));
    return ok({ deleted: ids.length });
  } catch (e: any) {
    console.error(e);
    return bad("Failed to delete invoices", 500);
  }
}
