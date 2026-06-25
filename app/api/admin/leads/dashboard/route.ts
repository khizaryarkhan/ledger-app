/**
 * Admin — Leads sales command-center data.
 *
 * GET /api/admin/leads/dashboard   (platform/super admin)
 *
 * One call that powers the closer's cockpit: pipeline funnel + conversion,
 * this-week activity, today's action queue (overdue + due-today tasks),
 * prioritised hot leads, and a team leaderboard. Read-only.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { landingPageRequests, leadTasks, leadSequenceSends, users, crmEmails, crmActivities, opportunities } from "@/db/schema";
import { eq, and, isNull, isNotNull, gte, lte, sql } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/billing";

export const maxDuration = 60;

const OPEN_STATUSES = ["new", "contacted", "qualified"];
const STAGE_WEIGHT: Record<string, number> = { qualified: 30, contacted: 18, new: 10 };

export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const now = Date.now();
  const weekAgo = new Date(now - 7 * 86400000);
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);

  const leads = await db.select({
    id: landingPageRequests.id, fullName: landingPageRequests.fullName, companyName: landingPageRequests.companyName,
    email: landingPageRequests.email, status: landingPageRequests.status,
    assignedToAdminId: landingPageRequests.assignedToAdminId,
    createdAt: landingPageRequests.createdAt, updatedAt: landingPageRequests.updatedAt,
  }).from(landingPageRequests);

  // ── Pipeline counts ─────────────────────────────────────────────────────
  const pipeline: Record<string, number> = { new: 0, contacted: 0, qualified: 0, converted: 0, rejected: 0, archived: 0 };
  for (const l of leads) pipeline[l.status] = (pipeline[l.status] ?? 0) + 1;
  const openCount = OPEN_STATUSES.reduce((s, k) => s + (pipeline[k] ?? 0), 0);
  const decided = pipeline.converted + pipeline.rejected;
  const winRate = decided > 0 ? Math.round((pipeline.converted / decided) * 100) : 0;

  // ── This week ───────────────────────────────────────────────────────────
  const newThisWeek = leads.filter(l => l.createdAt && new Date(l.createdAt) >= weekAgo).length;
  const wonThisWeek = leads.filter(l => l.status === "converted" && l.updatedAt && new Date(l.updatedAt) >= weekAgo).length;
  const sentRows = await db
    .select({ id: leadSequenceSends.id })
    .from(leadSequenceSends)
    .where(and(eq(leadSequenceSends.status, "sent"), gte(leadSequenceSends.sentAt, weekAgo)));
  const emailsSent = sentRows.length;

  // ── Today's action queue (overdue + due today, not completed) ────────────
  const leadById = new Map(leads.map(l => [l.id, l]));
  const tasks = await db.select({
    id: leadTasks.id, leadId: leadTasks.leadId, title: leadTasks.title, dueDate: leadTasks.dueDate, assignedTo: leadTasks.assignedTo,
  }).from(leadTasks).where(and(isNull(leadTasks.completedAt), isNotNull(leadTasks.dueDate), lte(leadTasks.dueDate, endOfToday)));

  const todayQueue = tasks
    .map(t => {
      const lead = leadById.get(t.leadId);
      const due = t.dueDate ? new Date(t.dueDate).getTime() : 0;
      return {
        taskId: t.id, title: t.title, dueDate: due, overdue: due < now - 86400000 ? true : new Date(due).toDateString() !== new Date().toDateString() && due < now,
        leadId: t.leadId, leadName: lead?.fullName ?? "—", company: lead?.companyName ?? null, status: lead?.status ?? "—",
      };
    })
    .sort((a, b) => a.dueDate - b.dueDate);

  // ── Engagement signals (from the durable email + activity + deal spine) ───
  const emailAgg = await db.select({
    leadId:   crmEmails.leadId,
    inbound:  sql<number>`(count(*) filter (where ${crmEmails.direction} = 'inbound'))::int`,
    outbound: sql<number>`(count(*) filter (where ${crmEmails.direction} = 'outbound'))::int`,
  }).from(crmEmails).groupBy(crmEmails.leadId);
  const repliesByLead = new Map<string, number>();
  const sentByLead = new Map<string, number>();
  for (const e of emailAgg) if (e.leadId) { repliesByLead.set(e.leadId, e.inbound); sentByLead.set(e.leadId, e.outbound); }

  const actAgg = await db.select({ leadId: crmActivities.leadId, lastAt: sql<string | null>`max(${crmActivities.occurredAt})` })
    .from(crmActivities).groupBy(crmActivities.leadId);
  const lastActByLead = new Map<string, number>();
  for (const a of actAgg) if (a.leadId && a.lastAt) lastActByLead.set(a.leadId, new Date(a.lastAt).getTime());

  const dealAgg = await db.select({
    leadId: opportunities.leadId,
    open:   sql<number>`(count(*) filter (where ${opportunities.status} = 'open'))::int`,
    maxVal: sql<number>`coalesce(max(${opportunities.value}), 0)::int`,
  }).from(opportunities).groupBy(opportunities.leadId);
  const dealByLead = new Map<string, { open: number; maxVal: number }>();
  for (const d of dealAgg) if (d.leadId) dealByLead.set(d.leadId, { open: d.open, maxVal: d.maxVal });

  // ── Hot leads — multi-signal score (0–100) ────────────────────────────────
  // stage + recency-of-last-touch + replies (strong intent) + outreach engaged
  // + open task + open deal/value, minus a staleness penalty.
  const leadsWithOpenTask = new Set(tasks.map(t => t.leadId));
  const hotLeads = leads
    .filter(l => OPEN_STATUSES.includes(l.status))
    .map(l => {
      const ageDays = l.createdAt ? (now - new Date(l.createdAt).getTime()) / 86400000 : 999;
      const lastAct = lastActByLead.get(l.id) ?? (l.updatedAt ? new Date(l.updatedAt).getTime() : 0);
      const daysSinceActivity = lastAct ? (now - lastAct) / 86400000 : ageDays;
      const replies = repliesByLead.get(l.id) ?? 0;
      const sent = sentByLead.get(l.id) ?? 0;
      const deal = dealByLead.get(l.id);
      let score = STAGE_WEIGHT[l.status] ?? 0;
      score += Math.max(0, 20 - daysSinceActivity);            // recent touch = hotter
      score += replies * 15;                                   // a reply is the strongest signal
      score += Math.min(sent, 5) * 2;                          // engaged in a conversation
      if (leadsWithOpenTask.has(l.id)) score += 8;
      if (deal && deal.open > 0) score += 20;                  // active deal
      if (deal && deal.maxVal) score += Math.min(deal.maxVal / 1000, 15); // deal size
      if (daysSinceActivity > 14) score -= 10;                 // going cold
      score = Math.max(0, Math.min(100, score));
      return {
        id: l.id, fullName: l.fullName, companyName: l.companyName, email: l.email, status: l.status,
        createdAt: l.createdAt ? new Date(l.createdAt).getTime() : null,
        ageDays: Math.round(ageDays), hasTask: leadsWithOpenTask.has(l.id),
        replies, daysSinceActivity: Math.round(daysSinceActivity), score: Math.round(score),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  // Stale: open leads with no open task and older than 5 days (no-lead-left-behind).
  const staleCount = leads.filter(l =>
    OPEN_STATUSES.includes(l.status) && !leadsWithOpenTask.has(l.id) &&
    l.createdAt && (now - new Date(l.createdAt).getTime()) / 86400000 > 5
  ).length;

  // ── Team leaderboard ────────────────────────────────────────────────────
  const admins = await db.select({ id: users.id, name: users.name }).from(users);
  const nameById = new Map(admins.map(a => [a.id, a.name]));
  const teamMap = new Map<string, { adminId: string; name: string; open: number; converted: number }>();
  let unassignedOpen = 0;
  for (const l of leads) {
    const aid = l.assignedToAdminId;
    if (!aid) { if (OPEN_STATUSES.includes(l.status)) unassignedOpen++; continue; }
    const row = teamMap.get(aid) ?? { adminId: aid, name: nameById.get(aid) ?? "—", open: 0, converted: 0 };
    if (OPEN_STATUSES.includes(l.status)) row.open++;
    if (l.status === "converted") row.converted++;
    teamMap.set(aid, row);
  }
  const team = [...teamMap.values()].sort((a, b) => b.converted - a.converted);

  return NextResponse.json({
    pipeline, openCount, winRate,
    thisWeek: { newLeads: newThisWeek, emailsSent, won: wonThisWeek },
    todayQueue, hotLeads, staleCount,
    team, unassignedOpen,
  });
}
