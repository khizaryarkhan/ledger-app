/**
 * Notifications and announcements — the feed, read state and admin posting.
 * Rules live in ./rules.ts; producers call ./notify.ts (kept separate so the
 * timesheet modules can import it without an import cycle through here).
 */

import { db } from "@/db";
import {
  notifications, announcements, announcementReads, users,
  timesheetReturns, hoursVarianceEnquiries,
} from "@/db/schema";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { TimeCtx } from "@/lib/resources/time-entries-server";
import { approvalCount } from "@/lib/resources/time-entries-server";
import { mayApproveAnyone } from "@/lib/resources/access";
import {
  isLive, expiryDay, expiresAtFor, mergeFeed, unreadCount, attentionItems,
  type FeedEvent, type FeedAnnouncement, type FeedItem,
  type AttentionItem, type AnnouncementInput,
} from "./rules";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

// ── Feed ─────────────────────────────────────────────────────────────────────

const FEED_LIMIT = 100;

async function liveAnnouncements(orgId: string, userId: string, now: Date): Promise<FeedAnnouncement[]> {
  const rows = await db.select({
    id: announcements.id, title: announcements.title, body: announcements.body, pinned: announcements.pinned,
    publishedAt: announcements.publishedAt, expiresAt: announcements.expiresAt, authorName: users.name,
    readId: announcementReads.id,
  }).from(announcements)
    .leftJoin(users, eq(users.id, announcements.createdBy))
    .leftJoin(announcementReads, and(eq(announcementReads.announcementId, announcements.id), eq(announcementReads.userId, userId)))
    .where(and(eq(announcements.orgId, orgId), or(isNull(announcements.expiresAt), gte(announcements.expiresAt, now))))
    .orderBy(desc(announcements.publishedAt))
    .limit(FEED_LIMIT);
  return rows.filter((r) => isLive(r, now)).map((r) => ({
    id: r.id, title: r.title, body: r.body, pinned: r.pinned,
    publishedAt: (iso(r.publishedAt) as string), expiresOn: expiryDay(r.expiresAt),
    authorName: r.authorName ?? null, read: !!r.readId,
  }));
}

async function recentEvents(orgId: string, userId: string): Promise<FeedEvent[]> {
  const rows = await db.select().from(notifications)
    .where(and(eq(notifications.orgId, orgId), eq(notifications.userId, userId)))
    .orderBy(desc(notifications.createdAt))
    .limit(FEED_LIMIT);
  return rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title, body: r.body ?? null, href: r.href ?? null,
    createdAt: iso(r.createdAt) as string, readAt: iso(r.readAt),
  }));
}

/** What needs this person now — counted live from the same rules the screens use. */
export async function attentionFor(ctx: TimeCtx): Promise<AttentionItem[]> {
  const me = ctx.actor.resourceId;
  const [approvals, returns, enquiries] = await Promise.all([
    mayApproveAnyone(ctx.actor, ctx.people) ? approvalCount(ctx) : Promise.resolve(0),
    me ? countOf(db.select({ n: sql<number>`count(*)::int` }).from(timesheetReturns)
      .where(and(eq(timesheetReturns.orgId, ctx.orgId), eq(timesheetReturns.resourceId, me), isNull(timesheetReturns.acknowledgedAt)))) : Promise.resolve(0),
    me ? countOf(db.select({ n: sql<number>`count(*)::int` }).from(hoursVarianceEnquiries)
      .where(and(eq(hoursVarianceEnquiries.orgId, ctx.orgId), eq(hoursVarianceEnquiries.assignedTo, me), eq(hoursVarianceEnquiries.status, "open")))) : Promise.resolve(0),
  ]);
  return attentionItems({ approvals, returns, enquiries });
}

async function countOf(q: Promise<{ n: number }[]>): Promise<number> {
  const [r] = await q;
  return Number(r?.n ?? 0);
}

export interface Feed { items: FeedItem[]; unread: number; attention: AttentionItem[] }

export async function loadFeed(ctx: TimeCtx, now: Date = new Date()): Promise<Feed> {
  if (!ctx.userId || !UUID_RE.test(ctx.userId)) return { items: [], unread: 0, attention: [] };
  const [events, anns, attention] = await Promise.all([
    recentEvents(ctx.orgId, ctx.userId),
    liveAnnouncements(ctx.orgId, ctx.userId, now),
    attentionFor(ctx),
  ]);
  return { items: mergeFeed(events, anns), unread: unreadCount(events, anns), attention };
}

/** Just the badge number — unread events plus unread live announcements. */
export async function unreadFor(orgId: string, userId: string | null, now: Date = new Date()): Promise<number> {
  if (!userId || !UUID_RE.test(userId)) return 0;
  const [events, anns] = await Promise.all([
    countOf(db.select({ n: sql<number>`count(*)::int` }).from(notifications)
      .where(and(eq(notifications.orgId, orgId), eq(notifications.userId, userId), isNull(notifications.readAt)))),
    liveAnnouncements(orgId, userId, now),
  ]);
  return events + anns.filter((a) => !a.read).length;
}

/**
 * Mark read. Scoped to the caller inside every WHERE clause, so an id that
 * belongs to someone else changes nothing. Announcements must be this org's.
 */
export async function markRead(
  orgId: string, userId: string,
  input: { eventIds?: unknown; announcementIds?: unknown; all?: unknown },
): Promise<void> {
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)).slice(0, 500) : []);
  const now = new Date();
  if (input.all === true) {
    await db.update(notifications).set({ readAt: now })
      .where(and(eq(notifications.orgId, orgId), eq(notifications.userId, userId), isNull(notifications.readAt)));
    const anns = await liveAnnouncements(orgId, userId, now);
    await recordAnnouncementReads(orgId, userId, anns.filter((a) => !a.read).map((a) => a.id));
    return;
  }
  const ev = ids(input.eventIds);
  if (ev.length) {
    await db.update(notifications).set({ readAt: now })
      .where(and(eq(notifications.orgId, orgId), eq(notifications.userId, userId), inArray(notifications.id, ev), isNull(notifications.readAt)));
  }
  await recordAnnouncementReads(orgId, userId, ids(input.announcementIds));
}

async function recordAnnouncementReads(orgId: string, userId: string, annIds: string[]): Promise<void> {
  if (annIds.length === 0) return;
  const owned = await db.select({ id: announcements.id }).from(announcements)
    .where(and(eq(announcements.orgId, orgId), inArray(announcements.id, annIds)));
  if (owned.length === 0) return;
  await db.insert(announcementReads).values(owned.map((a) => ({ announcementId: a.id, userId }))).onConflictDoNothing();
}

// ── Announcements (admin) ────────────────────────────────────────────────────

export interface AnnouncementAdminRow {
  id: string; title: string; body: string; pinned: boolean; publishedAt: string; expiresOn: string | null;
  authorName: string | null; live: boolean; readCount: number;
}

export async function listAnnouncements(orgId: string, now: Date = new Date()): Promise<AnnouncementAdminRow[]> {
  const rows = await db.select({
    id: announcements.id, title: announcements.title, body: announcements.body, pinned: announcements.pinned,
    publishedAt: announcements.publishedAt, expiresAt: announcements.expiresAt, authorName: users.name,
    readCount: sql<number>`(select count(*)::int from announcement_reads r where r.announcement_id = ${announcements.id})`,
  }).from(announcements)
    .leftJoin(users, eq(users.id, announcements.createdBy))
    .where(eq(announcements.orgId, orgId))
    .orderBy(desc(announcements.publishedAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.id, title: r.title, body: r.body, pinned: r.pinned,
    publishedAt: iso(r.publishedAt) as string, expiresOn: expiryDay(r.expiresAt),
    authorName: r.authorName ?? null, live: isLive(r, now), readCount: Number(r.readCount ?? 0),
  }));
}

export async function createAnnouncement(orgId: string, userId: string | null, a: AnnouncementInput): Promise<string> {
  const [row] = await db.insert(announcements).values({
    orgId, title: a.title, body: a.body, pinned: a.pinned, expiresAt: expiresAtFor(a.expiresOn), createdBy: userId,
  }).returning({ id: announcements.id });
  return row.id;
}

export async function updateAnnouncement(orgId: string, id: string, a: AnnouncementInput): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const rows = await db.update(announcements).set({
    title: a.title, body: a.body, pinned: a.pinned, expiresAt: expiresAtFor(a.expiresOn), updatedAt: new Date(),
  }).where(and(eq(announcements.id, id), eq(announcements.orgId, orgId))).returning({ id: announcements.id });
  return rows.length > 0;
}

export async function deleteAnnouncement(orgId: string, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const rows = await db.delete(announcements)
    .where(and(eq(announcements.id, id), eq(announcements.orgId, orgId))).returning({ id: announcements.id });
  return rows.length > 0;
}
