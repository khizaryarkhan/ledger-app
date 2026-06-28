import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { leadTasks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/admin/activities";

// Generic task ops by task id (works for account- or lead-scoped tasks).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const b = await req.json().catch(() => ({} as any));
  const [task] = await db.update(leadTasks)
    .set({ completedAt: b.completed ? new Date() : null })
    .where(eq(leadTasks.id, params.id)).returning();
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (b.completed) await logActivity({ type: "task_completed", title: `Task completed: ${task.title}`.slice(0, 300), accountId: task.accountId, leadId: task.leadId });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  await db.delete(leadTasks).where(eq(leadTasks.id, params.id));
  return NextResponse.json({ deleted: true });
}
