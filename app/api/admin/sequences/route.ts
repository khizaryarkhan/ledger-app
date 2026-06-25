import { ok, bad } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { leadSequences } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  // Per-sequence performance stats computed inline (enrollments + sends).
  const sequences = await db.select({
    id:          leadSequences.id,
    name:        leadSequences.name,
    description: leadSequences.description,
    isActive:    leadSequences.isActive,
    createdAt:   leadSequences.createdAt,
    updatedAt:   leadSequences.updatedAt,
    stepCount:   sql<number>`(SELECT COUNT(*)::int FROM lead_sequence_steps WHERE sequence_id = lead_sequences.id)`,
    enrolled:    sql<number>`(SELECT COUNT(*)::int FROM lead_sequence_enrollments WHERE sequence_id = lead_sequences.id)`,
    active:      sql<number>`(SELECT COUNT(*)::int FROM lead_sequence_enrollments WHERE sequence_id = lead_sequences.id AND status = 'active')`,
    completed:   sql<number>`(SELECT COUNT(*)::int FROM lead_sequence_enrollments WHERE sequence_id = lead_sequences.id AND status = 'completed')`,
    cancelled:   sql<number>`(SELECT COUNT(*)::int FROM lead_sequence_enrollments WHERE sequence_id = lead_sequences.id AND status = 'cancelled')`,
    sent:        sql<number>`(SELECT COUNT(*)::int FROM lead_sequence_sends s JOIN lead_sequence_enrollments e ON s.enrollment_id = e.id WHERE e.sequence_id = lead_sequences.id AND s.status = 'sent')`,
    pending:     sql<number>`(SELECT COUNT(*)::int FROM lead_sequence_sends s JOIN lead_sequence_enrollments e ON s.enrollment_id = e.id WHERE e.sequence_id = lead_sequences.id AND s.status = 'pending')`,
    failed:      sql<number>`(SELECT COUNT(*)::int FROM lead_sequence_sends s JOIN lead_sequence_enrollments e ON s.enrollment_id = e.id WHERE e.sequence_id = lead_sequences.id AND s.status = 'failed')`,
  }).from(leadSequences).orderBy(desc(leadSequences.createdAt));

  return ok(sequences);
}

export async function POST(req: NextRequest) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const { name, description, isActive } = await req.json().catch(() => ({}));
  if (!name?.trim()) return bad("Name is required");

  const [seq] = await db.insert(leadSequences).values({
    name:        name.trim(),
    description: description?.trim() || null,
    isActive:    isActive ?? true,
    createdBy:   userId ?? null,
  }).returning();

  return ok({ ...seq, stepCount: 0, enrolled: 0, active: 0, completed: 0, cancelled: 0, sent: 0, pending: 0, failed: 0 });
}
