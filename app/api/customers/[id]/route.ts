import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [c] = await db.select().from(customers).where(eq(customers.id, params.id)).limit(1);
  if (!c) return bad("Not found", 404);
  return ok(c);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const body = await req.json();
  const [updated] = await db.update(customers).set({ ...body, updatedAt: new Date() }).where(eq(customers.id, params.id)).returning();
  if (!updated) return bad("Not found", 404);
  return ok(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  await db.delete(customers).where(eq(customers.id, params.id));
  return ok({ ok: true });
}
