import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { purchaseRequests } from "@/db/schema";
import { eq, and, ilike, desc } from "drizzle-orm";
import { z } from "zod";
import { logEvent } from "@/lib/audit";

const CreateSchema = z.object({
  title:                 z.string().min(1).max(500),
  description:           z.string().optional().nullable(),
  businessJustification: z.string().optional().nullable(),
  supplierId:            z.string().uuid().optional().nullable(),
  requiredByDate:        z.string().optional().nullable(),
  currency:              z.string().max(8).default("EUR"),
  estimatedTotal:        z.number().optional().nullable(),
  notes:                 z.string().optional().nullable(),
  departmentId:          z.string().optional().nullable(),
  projectId:             z.string().optional().nullable(),
  costCentreId:          z.string().optional().nullable(),
});

async function generateRequestNumber(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const seq  = Date.now().toString().slice(-6);
  return `PR-${year}-${seq}`;
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  const conditions: any[] = [eq(purchaseRequests.orgId, orgId!)];
  if (status) conditions.push(eq(purchaseRequests.status, status));
  if (search) conditions.push(ilike(purchaseRequests.title, `%${search}%`));

  const rows = await db.select().from(purchaseRequests)
    .where(and(...conditions))
    .orderBy(desc(purchaseRequests.createdAt));
  return ok(rows);
}

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  try {
    const data = CreateSchema.parse(await req.json());
    const requesterId = (session?.user as any)?.id ?? null;
    const requestNumber = await generateRequestNumber(orgId!);

    const [created] = await db.insert(purchaseRequests).values({
      orgId:                 orgId!,
      requestNumber,
      requesterId,
      title:                 data.title,
      description:           data.description ?? null,
      businessJustification: data.businessJustification ?? null,
      supplierId:            data.supplierId ?? null,
      requiredByDate:        data.requiredByDate ?? null,
      currency:              data.currency,
      estimatedTotal:        data.estimatedTotal ?? null,
      notes:                 data.notes ?? null,
      departmentId:          data.departmentId ?? null,
      projectId:             data.projectId ?? null,
      costCentreId:          data.costCentreId ?? null,
      status:                "Draft",
    }).returning();

    await logEvent({
      orgId: orgId!,
      eventType: "purchase_request_created" as any,
      actorId:   requesterId,
      actorName: (session?.user as any)?.name ?? null,
      meta:      { requestNumber: created.requestNumber, title: created.title },
    });

    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to create purchase request", 500);
  }
}
