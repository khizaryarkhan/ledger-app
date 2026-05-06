import { db } from "@/db";
import { invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, params.id)).limit(1);
  if (!inv) return bad("Not found", 404);
  return ok(inv);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const body = await req.json();
  const [updated] = await db.update(invoices).set({ ...body, updatedAt: new Date() }).where(eq(invoices.id, params.id)).returning();
  if (!updated) return bad("Not found", 404);
  return ok(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  await db.delete(invoices).where(eq(invoices.id, params.id));
  return ok({ ok: true });
}
