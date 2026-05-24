import { db } from "@/db";
import { auditEvents } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, desc, eq, or, SQL } from "drizzle-orm";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const projectId  = searchParams.get("projectId");
  const invoiceId  = searchParams.get("invoiceId");
  const limit      = Math.min(parseInt(searchParams.get("limit") ?? "200") || 200, 500);

  if (!customerId && !projectId && !invoiceId) {
    return bad("Provide customerId, projectId, or invoiceId", 400);
  }

  // Build entity filter
  let entityFilter: SQL | undefined;
  if (invoiceId) {
    entityFilter = eq(auditEvents.invoiceId, invoiceId);
  } else if (projectId && customerId) {
    entityFilter = or(eq(auditEvents.projectId, projectId), eq(auditEvents.customerId, customerId));
  } else if (projectId) {
    entityFilter = eq(auditEvents.projectId, projectId);
  } else if (customerId) {
    entityFilter = eq(auditEvents.customerId, customerId);
  }

  const rows = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.orgId, orgId!), entityFilter))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(limit);

  return ok(rows);
}
