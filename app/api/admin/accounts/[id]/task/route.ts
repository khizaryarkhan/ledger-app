import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmAccounts, landingPageRequests, leadTasks } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/admin/activities";

// POST — add a task to an account (works for any company). Stored account-scoped
// so it appears on the cockpit and in the Today queue regardless of a lead.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const b = await req.json().catch(() => ({} as any));
  if (!b.title?.trim()) return NextResponse.json({ error: "Task title is required" }, { status: 400 });

  const [account] = await db.select({ id: crmAccounts.id }).from(crmAccounts).where(eq(crmAccounts.id, params.id)).limit(1);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const [lead] = await db.select({ id: landingPageRequests.id }).from(landingPageRequests)
    .where(eq(landingPageRequests.accountId, params.id)).orderBy(desc(landingPageRequests.createdAt)).limit(1);

  const prio = ["low", "normal", "high"].includes(b.priority) ? b.priority : "normal";
  const kind = ["todo", "call", "email", "follow_up"].includes(b.type) ? b.type : "todo";

  const [task] = await db.insert(leadTasks).values({
    accountId: params.id, leadId: lead?.id ?? null, title: b.title.trim().slice(0, 500),
    dueDate: b.dueDate ? new Date(b.dueDate) : null, priority: prio, type: kind, createdBy: userId ?? null,
  }).returning();

  await logActivity({ type: "task_created", title: `Task: ${b.title.trim()}`.slice(0, 300), accountId: params.id, leadId: lead?.id ?? null, actorId: userId, meta: b.dueDate ? { dueDate: b.dueDate } : undefined });

  return NextResponse.json(task, { status: 201 });
}
