import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { leadTasks, landingPageRequests, crmAccounts, users } from "@/db/schema";
import { eq, isNull, desc, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { formatAccountRef } from "@/lib/admin/accounts";

// GET /api/admin/queue?owner=me|all — the daily sales queue: every OPEN task,
// joined to its lead + account, so a rep sees "what to do today" in one place.
// Bucketing (overdue / today / upcoming / someday) is done client-side off dueDate.
export async function GET(req: NextRequest) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const scope = new URL(req.url).searchParams.get("owner") ?? "all";

  // Account-scoped: every open task, with its company resolved via the task's
  // accountId (preferred) or its lead. LEFT joins so account-only tasks appear too.
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
      taskAccountId: leadTasks.accountId,
      leadName:   landingPageRequests.fullName,
      company:    landingPageRequests.companyName,
      leadAccountId: landingPageRequests.accountId,
    })
    .from(leadTasks)
    .leftJoin(landingPageRequests, eq(leadTasks.leadId, landingPageRequests.id))
    .where(isNull(leadTasks.completedAt))
    .orderBy(desc(leadTasks.dueDate))
    .limit(500);

  // Resolve account names/refs for the accounts referenced.
  const acctIds = Array.from(new Set(rows.map(r => r.taskAccountId ?? r.leadAccountId).filter(Boolean))) as string[];
  const acctRows = acctIds.length
    ? await db.select({ id: crmAccounts.id, refSeq: crmAccounts.refSeq, name: crmAccounts.name, lifecycle: crmAccounts.lifecycleStage })
        .from(crmAccounts).where(inArray(crmAccounts.id, acctIds))
    : [];
  const acctById = new Map(acctRows.map(a => [a.id, a]));

  const tasks = rows
    .filter(r => scope !== "me" || r.assignedTo === userId || r.createdBy === userId)
    .map(r => {
      const accountId = (r.taskAccountId ?? r.leadAccountId) ?? null;
      const acc = accountId ? acctById.get(accountId) : null;
      return {
        id: r.id, title: r.title, dueDate: r.dueDate, priority: r.priority, type: r.type,
        leadId: r.leadId, leadName: r.leadName, company: r.company,
        accountId, accountRef: acc?.refSeq ? formatAccountRef(acc.refSeq) : null,
        accountName: acc?.name ?? r.company ?? r.leadName, lifecycle: acc?.lifecycle ?? null,
      };
    });

  // Admins for the optional assignee display / future filtering.
  const admins = await db.select({ id: users.id, name: users.name, email: users.email })
    .from(users).where(eq(users.status, "Active"));

  return NextResponse.json({ tasks, admins });
}
