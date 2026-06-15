import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { paymentRuns } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const CreateSchema = z.object({
  currency:             z.string().max(8).default("EUR"),
  scheduledPaymentDate: z.string().optional().nullable(),
  notes:                z.string().optional().nullable(),
});

async function generateRunNumber(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const seq  = Date.now().toString().slice(-6);
  return `PR-RUN-${year}-${seq}`;
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const conditions: any[] = [eq(paymentRuns.orgId, orgId!)];
  if (status) conditions.push(eq(paymentRuns.status, status));

  const rows = await db.select().from(paymentRuns)
    .where(and(...conditions))
    .orderBy(desc(paymentRuns.createdAt));
  return ok(rows);
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  try {
    const data = CreateSchema.parse(await req.json());
    const actorId   = (session?.user as any)?.id ?? null;
    const runNumber = await generateRunNumber(orgId!);

    const [created] = await db.insert(paymentRuns).values({
      orgId:                orgId!,
      runNumber,
      currency:             data.currency,
      scheduledPaymentDate: data.scheduledPaymentDate ?? null,
      notes:                data.notes ?? null,
      status:               "Draft",
      totalAmount:          0,
      billCount:            0,
      createdByUserId:      actorId,
    }).returning();

    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to create payment run", 500);
  }
}
