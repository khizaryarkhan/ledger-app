import { ok, bad } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/billing";
import { logActivity } from "@/lib/admin/activities";
import { db } from "@/db";
import { leadTasks } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const tasks = await db
    .select()
    .from(leadTasks)
    .where(eq(leadTasks.leadId, params.id))
    .orderBy(asc(leadTasks.createdAt));

  return ok(tasks);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const { title, dueDate, priority, type } = await req.json().catch(() => ({}));
  if (!title?.trim()) return bad("Task title is required");

  const createdBy = userId ?? null;
  const prio = ["low", "normal", "high"].includes(priority) ? priority : "normal";
  const kind = ["todo", "call", "email", "follow_up"].includes(type) ? type : "todo";

  const [task] = await db.insert(leadTasks).values({
    leadId:    params.id,
    title:     title.trim(),
    dueDate:   dueDate ? new Date(dueDate) : null,
    priority:  prio,
    type:      kind,
    createdBy,
  }).returning();

  await logActivity({ type: "task_created", title: `Task: ${title.trim()}`.slice(0, 300), leadId: params.id, actorId: createdBy, meta: dueDate ? { dueDate } : undefined });

  return ok(task);
}
