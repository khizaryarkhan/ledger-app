import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { db } from "@/db";
import { leadSequences } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const { name, description, isActive } = await req.json().catch(() => ({}));
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (name      !== undefined) updates.name        = name.trim();
  if (description !== undefined) updates.description = description?.trim() || null;
  if (isActive  !== undefined) updates.isActive    = isActive;

  const [seq] = await db.update(leadSequences).set(updates)
    .where(eq(leadSequences.id, params.id)).returning();
  if (!seq) return bad("Sequence not found", 404);
  return ok(seq);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  await db.delete(leadSequences).where(eq(leadSequences.id, params.id));
  return ok({ deleted: true });
}
