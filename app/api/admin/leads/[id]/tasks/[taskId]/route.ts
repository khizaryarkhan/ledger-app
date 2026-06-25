import { ok, bad } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { leadTasks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; taskId: string } },
) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const { completed } = await req.json().catch(() => ({}));

  const [task] = await db
    .update(leadTasks)
    .set({ completedAt: completed ? new Date() : null })
    .where(and(eq(leadTasks.id, params.taskId), eq(leadTasks.leadId, params.id)))
    .returning();

  if (!task) return bad("Task not found", 404);
  return ok(task);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; taskId: string } },
) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  await db.delete(leadTasks).where(
    and(eq(leadTasks.id, params.taskId), eq(leadTasks.leadId, params.id)),
  );
  return ok({ deleted: true });
}
