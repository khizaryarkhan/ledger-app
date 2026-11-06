/**
 * GET  /api/resources/announcements -> every announcement, live or not, with read counts (org admins)
 * POST /api/resources/announcements { title, body, pinned?, expiresOn?, today? } -> { id } (org admins)
 *
 * Everyone READS announcements through their own feed (/api/resources/me/notifications);
 * this route is only the admin side: posting, editing and removing company news.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { isAdminRole } from "@/lib/resources/access";
import { parseAnnouncement } from "@/lib/notifications/rules";
import { listAnnouncements, createAnnouncement } from "@/lib/notifications/server";
import { isRealDate } from "@/lib/resources/time-entry-rules";
import { today as utcToday } from "@/lib/format";

async function admin() {
  const r = await requireOrg();
  if (r.error) return { error: r.error };
  const { error: modErr } = await requireModule(r.orgId!, "resources");
  if (modErr) return { error: modErr };
  if (!isAdminRole(r.role)) return { error: bad("Only organisation admins can manage announcements", 403) };
  return { orgId: r.orgId!, userId: ((r.session?.user as any)?.id as string | undefined) ?? null };
}

export async function GET() {
  const a = await admin();
  if ("error" in a) return a.error;
  return ok(await listAnnouncements(a.orgId));
}

export async function POST(req: Request) {
  const a = await admin();
  if ("error" in a) return a.error;
  const body = await req.json().catch(() => ({}));
  // The poster's own date decides "in the past" (a date is a date); fall back to UTC.
  const today = typeof body?.today === "string" && isRealDate(body.today) ? body.today : utcToday();
  const parsed = parseAnnouncement(body, today);
  if (parsed.ok === false) return bad(parsed.error);
  return ok({ id: await createAnnouncement(a.orgId, a.userId, parsed.value) });
}
