import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { leadTasks, landingPageRequests, crmAccounts, users } from "@/db/schema";
import { eq, isNull, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { formatAccountRef } from "@/lib/admin/accounts";

// GET /api/admin/queue?owner=me|all — the daily sales queue: every OPEN task,
// joined to its lead + account, so a rep sees "what to do today" in one place.
// Bucketing (overdue / today / upcoming / someday) is done client-side off dueDate.
export async function GET(req: NextRequest) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const scope = new URL(req.url).searchParams.get("owner") ?? "all";

  const rows = await db
    .select({
      id:         leadTasks.id,
      title:      leadTasks.title,
      dueDate:    leadTasks.dueDate,
      priority:   leadTasks.priority,
      type:       leadTasks.type,
      assignedTo: leadTasks.assignedTo,
      createdBy:  leadTasks.createdBy,
      leadId:     leadTasks.leadId,
      leadName:   landingPageRequests.fullName,
      company:    landingPageRequests.companyName,
      accountId:  crmAccounts.id,
      accountRefSeq: crmAccounts.refSeq,
      accountName:   crmAccounts.name,
      lifecycle:     crmAccounts.lifecycleStage,
    })
    .from(leadTasks)
    .innerJoin(landingPageRequests, eq(leadTasks.leadId, landingPageRequests.id))
    .leftJoin(crmAccounts, eq(landingPageRequests.accountId, crmAccounts.id))
    .where(isNull(leadTasks.completedAt))
    .orderBy(desc(leadTasks.dueDate))
    .limit(500);

  const tasks = rows
    .filter(r => scope !== "me" || r.assignedTo === userId || r.createdBy === userId)
    .map(r => ({
      id: r.id, title: r.title, dueDate: r.dueDate, priority: r.priority, type: r.type,
      leadId: r.leadId, leadName: r.leadName, company: r.company,
      accountId: r.accountId, accountRef: r.accountRefSeq ? formatAccountRef(r.accountRefSeq) : null,
      accountName: r.accountName ?? r.company ?? r.leadName, lifecycle: r.lifecycle,
    }));

  // Admins for the optional assignee display / future filtering.
  const admins = await db.select({ id: users.id, name: users.name, email: users.email })
    .from(users).where(eq(users.status, "Active"));

  return NextResponse.json({ tasks, admins });
}
