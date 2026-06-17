import { db } from "@/db";
import { apBillComments, apBills } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and, asc } from "drizzle-orm";

// GET /api/payables/bills/[id]/comments
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [bill] = await db.select({ id: apBills.id })
    .from(apBills)
    .where(and(eq(apBills.id, params.id), eq(apBills.orgId, orgId!)))
    .limit(1);
  if (!bill) return bad("Bill not found", 404);

  const comments = await db.select().from(apBillComments)
    .where(and(eq(apBillComments.billId, params.id), eq(apBillComments.orgId, orgId!)))
    .orderBy(asc(apBillComments.createdAt));

  return ok(comments);
}

// POST /api/payables/bills/[id]/comments
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const [bill] = await db.select({ id: apBills.id })
    .from(apBills)
    .where(and(eq(apBills.id, params.id), eq(apBills.orgId, orgId!)))
    .limit(1);
  if (!bill) return bad("Bill not found", 404);

  const body = await req.json().catch(() => ({}));
  const text = (body.body ?? "").toString().trim().slice(0, 4000);
  if (!text) return bad("Comment body required");

  const channel = ["internal", "approver", "system", "email"].includes(body.channel)
    ? body.channel
    : "internal";

  const authorId   = (session?.user as any)?.id   ?? null;
  const authorName = (session?.user as any)?.name ?? "Team";

  const [comment] = await db.insert(apBillComments).values({
    orgId: orgId!,
    billId: params.id,
    body: text,
    authorId,
    authorName,
    channel,
  }).returning();

  return ok(comment);
}
