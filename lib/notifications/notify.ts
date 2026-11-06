/**
 * Producing notifications. Kept apart from ./server.ts (the feed) so the
 * timesheet and enquiry modules can import it without an import cycle.
 *
 * `notify` NEVER throws: a notification is a courtesy about something that has
 * already happened (a return, a reply, an enquiry), and it must never be able
 * to undo or fail that thing. Callers invoke it AFTER the real write; it
 * swallows (and logs) its own errors.
 */

import { db } from "@/db";
import { notifications, resources } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { NotificationKind } from "./rules";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NewNotification {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  href?: string | null;
  sourceType: string;
  sourceId: string;
}

/** Record events for their recipients. Idempotent per (user, kind, source); never throws. */
export async function notify(orgId: string, rows: readonly NewNotification[]): Promise<void> {
  const valid = rows.filter((r) => UUID_RE.test(r.userId) && UUID_RE.test(r.sourceId));
  if (valid.length === 0) return;
  try {
    await db.insert(notifications).values(valid.map((r) => ({
      orgId, userId: r.userId, kind: r.kind,
      title: r.title.slice(0, 200), body: r.body ? r.body.slice(0, 2000) : null,
      href: r.href ?? null, sourceType: r.sourceType, sourceId: r.sourceId,
    }))).onConflictDoNothing();
  } catch (e) {
    console.error("[notify] could not record notifications", { orgId, kinds: valid.map((r) => r.kind), e });
  }
}

/** resourceId -> the login that person uses (people without a login get nothing). */
export async function loginsForResources(orgId: string, resourceIds: readonly string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(resourceIds.filter((id) => UUID_RE.test(id))));
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: resources.id, userId: resources.userId }).from(resources)
    .where(and(eq(resources.orgId, orgId), inArray(resources.id, ids)));
  const out = new Map<string, string>();
  for (const r of rows) if (r.userId) out.set(r.id, r.userId);
  return out;
}
