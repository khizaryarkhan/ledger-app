import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { db } from "@/db";
import { leadTasks } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const tasks = await db
    .select()
    .from(leadTasks)
    .where(eq(leadTasks.leadId, params.id))
    .orderBy(asc(leadTasks.createdAt));

  return ok(tasks);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const { title, dueDate } = await req.json().catch(() => ({}));
  if (!title?.trim()) return bad("Task title is required");

  const createdBy = (session as any).user?.id ?? null;

  const [task] = await db.insert(leadTasks).values({
    leadId:    params.id,
    title:     title.trim(),
    dueDate:   dueDate ? new Date(dueDate) : null,
    createdBy,
  }).returning();

  return ok(task);
}
