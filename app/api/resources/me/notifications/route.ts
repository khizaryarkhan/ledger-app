/**
 * GET  /api/resources/me/notifications -> { items, unread, attention }
 *        The caller's own feed: events addressed to their login, live
 *        announcements, and live "needs your attention" counts.
 * POST /api/resources/me/notifications { eventIds?, announcementIds?, all? }
 *        Mark read. Scoped to the caller inside every query.
 *
 * Under /me so an employee (timesheet-only) login can reach it; it only ever
 * reads the signed-in user's own notifications, never a request id.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { buildCtx } from "@/lib/resources/time-entries-server";
import { loadFeed, markRead } from "@/lib/notifications/server";

export async function GET() {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;
  const ctx = await buildCtx(orgId!, session, role);
  return ok(await loadFeed(ctx));
}

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return bad("Unauthorized", 401);
  const body = await req.json().catch(() => ({}));
  await markRead(orgId!, userId, body ?? {});
  return ok({ ok: true });
}
