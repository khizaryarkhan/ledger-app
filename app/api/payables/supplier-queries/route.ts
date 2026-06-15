import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apSupplierQueries } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const CreateSchema = z.object({
  supplierId:        z.string().uuid().optional().nullable(),
  billId:            z.string().uuid().optional().nullable(),
  purchaseOrderId:   z.string().uuid().optional().nullable(),
  category:          z.string().min(1).max(64),
  reason:            z.string().optional().nullable(),
  assignedToUserId:  z.string().uuid().optional().nullable(),
  source:            z.string().max(32).default("manual"),
});

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const status     = searchParams.get("status");
  const supplierId = searchParams.get("supplierId");
  const billId     = searchParams.get("billId");

  const conditions: any[] = [eq(apSupplierQueries.orgId, orgId!)];
  if (status)     conditions.push(eq(apSupplierQueries.status, status));
  if (supplierId) conditions.push(eq(apSupplierQueries.supplierId, supplierId));
  if (billId)     conditions.push(eq(apSupplierQueries.billId, billId));

  const rows = await db.select().from(apSupplierQueries)
    .where(and(...conditions))
    .orderBy(desc(apSupplierQueries.createdAt));
  return ok(rows);
}

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  try {
    const data = CreateSchema.parse(await req.json());

    const [created] = await db.insert(apSupplierQueries).values({
      orgId:           orgId!,
      supplierId:      data.supplierId ?? null,
      billId:          data.billId ?? null,
      purchaseOrderId: data.purchaseOrderId ?? null,
      category:        data.category,
      reason:          data.reason ?? null,
      assignedToUserId: data.assignedToUserId ?? null,
      source:          data.source,
      status:          "Open",
    }).returning();

    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to create supplier query", 500);
  }
}
