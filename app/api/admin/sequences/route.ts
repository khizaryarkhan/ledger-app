import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { db } from "@/db";
import { leadSequences } from "@/db/schema";
import { desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET() {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const sequences = await db.select({
    id:          leadSequences.id,
    name:        leadSequences.name,
    description: leadSequences.description,
    isActive:    leadSequences.isActive,
    createdAt:   leadSequences.createdAt,
    updatedAt:   leadSequences.updatedAt,
    stepCount:   sql<number>`(SELECT COUNT(*)::int FROM lead_sequence_steps WHERE sequence_id = lead_sequences.id)`,
  }).from(leadSequences).orderBy(desc(leadSequences.createdAt));

  return ok(sequences);
}

export async function POST(req: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const { name, description, isActive } = await req.json().catch(() => ({}));
  if (!name?.trim()) return bad("Name is required");

  const [seq] = await db.insert(leadSequences).values({
    name:        name.trim(),
    description: description?.trim() || null,
    isActive:    isActive ?? true,
    createdBy:   (session as any).user?.id ?? null,
  }).returning();

  return ok({ ...seq, stepCount: 0 });
}
