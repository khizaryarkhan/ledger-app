/**
 * PATCH  /api/resources/announcements/[id] { title, body, pinned?, expiresOn?, today? } (org admins)
 * DELETE /api/resources/announcements/[id] (org admins)
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { isAdminRole } from "@/lib/resources/access";
import { parseAnnouncement } from "@/lib/notifications/rules";
import { updateAnnouncement, deleteAnnouncement } from "@/lib/notifications/server";
import { isRealDate } from "@/lib/resources/time-entry-rules";
import { today as utcToday } from "@/lib/format";

async function admin() {
  const r = await requireOrg();
  if (r.error) return { error: r.error };
  const { error: modErr } = await requireModule(r.orgId!, "resources");
  if (modErr) return { error: modErr };
  if (!isAdminRole(r.role)) return { error: bad("Only organisation admins can manage announcements", 403) };
  return { orgId: r.orgId! };
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const a = await admin();
  if ("error" in a) return a.error;
  const body = await req.json().catch(() => ({}));
  const today = typeof body?.today === "string" && isRealDate(body.today) ? body.today : utcToday();
  const parsed = parseAnnouncement(body, today);
  if (parsed.ok === false) return bad(parsed.error);
  if (!(await updateAnnouncement(a.orgId, params.id, parsed.value))) return bad("Announcement not found", 404);
  return ok({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await admin();
  if ("error" in a) return a.error;
  if (!(await deleteAnnouncement(a.orgId, params.id))) return bad("Announcement not found", 404);
  return ok({ ok: true });
}
