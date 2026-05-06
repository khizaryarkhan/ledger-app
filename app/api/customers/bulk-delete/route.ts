import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { inArray, eq, and } from "drizzle-orm";

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  try {
    const { ids } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) return bad("No customer IDs provided");
    await db.delete(customers).where(and(inArray(customers.id, ids), eq(customers.orgId, orgId!)));
    return ok({ deleted: ids.length });
  } catch (e: any) {
    return bad("Failed to delete customers", 500);
  }
}
