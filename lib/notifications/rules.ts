/**
 * Notifications and announcements — the pure rules (client-safe, no db).
 *
 * Generic on purpose: a notification is addressed to a person's LOGIN because
 * of something that happened to them, never to a role or a job title, so the
 * same producers fit any organisation. Announcements go to everyone in the
 * organisation.
 *
 * Two kinds of thing appear in a person's feed, and they are kept apart:
 * - EVENTS (stored, `notifications` table): time returned to you, a reply to a
 *   return you opened, an enquiry assigned to you. Each is idempotent by
 *   (user, kind, source) so a retried producer never notifies twice.
 * - ATTENTION (derived live, never stored): approvals waiting, returns you have
 *   not acknowledged, enquiries open on you. A stored "you have 3 approvals"
 *   would be wrong the moment one was decided; a live count cannot be.
 */

export const NOTIFICATION_KINDS = ["time_returned", "return_reply", "enquiry_assigned"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const ANNOUNCEMENT_TITLE_MAX = 200;
export const ANNOUNCEMENT_BODY_MAX = 10000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface AnnouncementInput {
  title: string;
  body: string;
  pinned: boolean;
  /** Last day it is shown (YYYY-MM-DD), or null to keep it until removed. */
  expiresOn: string | null;
}

/**
 * Validate an announcement. `today` is the poster's local date: an expiry
 * before it would publish something nobody can ever see, so it is refused
 * rather than saved.
 */
export function parseAnnouncement(raw: unknown, today: string): { ok: true; value: AnnouncementInput } | { ok: false; error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const title = String(b.title ?? "").trim();
  const body = String(b.body ?? "").trim();
  if (!title) return { ok: false, error: "A title is required" };
  if (title.length > ANNOUNCEMENT_TITLE_MAX) return { ok: false, error: `The title can be at most ${ANNOUNCEMENT_TITLE_MAX} characters` };
  if (!body) return { ok: false, error: "The announcement needs some text" };
  if (body.length > ANNOUNCEMENT_BODY_MAX) return { ok: false, error: `The text can be at most ${ANNOUNCEMENT_BODY_MAX} characters` };
  let expiresOn: string | null = null;
  if (b.expiresOn != null && b.expiresOn !== "") {
    const d = String(b.expiresOn);
    if (!DATE_RE.test(d) || !isRealDate(d)) return { ok: false, error: "The end date is not a valid date" };
    if (d < today) return { ok: false, error: "The end date is in the past, so nobody would see it" };
    expiresOn = d;
  }
  return { ok: true, value: { title, body, pinned: b.pinned === true, expiresOn } };
}

function isRealDate(d: string): boolean {
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
}

/**
 * The stored instant for "shown up to and including this day". Kept as the
 * UTC end of that day so an announcement never disappears early anywhere;
 * read back with `expiryDay`, never through a local Date.
 */
export const expiresAtFor = (day: string | null): Date | null => (day ? new Date(`${day}T23:59:59.999Z`) : null);
export const expiryDay = (at: Date | string | null): string | null => {
  if (!at) return null;
  const iso = typeof at === "string" ? at : at.toISOString();
  return iso.slice(0, 10);
};

/** Is it showing now? Published and not past its last day. */
export function isLive(a: { publishedAt: Date | string; expiresAt: Date | string | null }, now: Date): boolean {
  const pub = new Date(a.publishedAt).getTime();
  if (pub > now.getTime()) return false;
  if (a.expiresAt && new Date(a.expiresAt).getTime() < now.getTime()) return false;
  return true;
}

// ── The feed ────────────────────────────────────────────────────────────────

export interface FeedEvent {
  id: string; kind: string; title: string; body: string | null; href: string | null;
  createdAt: string; readAt: string | null;
}
export interface FeedAnnouncement {
  id: string; title: string; body: string; pinned: boolean;
  publishedAt: string; expiresOn: string | null; authorName: string | null; read: boolean;
}
export type FeedItem =
  | ({ type: "event" } & FeedEvent)
  | ({ type: "announcement" } & FeedAnnouncement);

/**
 * One feed: pinned announcements first, then everything newest first. Pinned
 * stays on top so a notice an admin marked important is not buried under a
 * busy week's returns.
 */
export function mergeFeed(events: readonly FeedEvent[], anns: readonly FeedAnnouncement[]): FeedItem[] {
  const pinned = anns.filter((a) => a.pinned)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .map((a) => ({ type: "announcement" as const, ...a }));
  const rest: (FeedItem & { at: string })[] = [
    ...anns.filter((a) => !a.pinned).map((a) => ({ type: "announcement" as const, ...a, at: a.publishedAt })),
    ...events.map((e) => ({ type: "event" as const, ...e, at: e.createdAt })),
  ];
  rest.sort((a, b) => b.at.localeCompare(a.at));
  return [...pinned, ...rest.map(({ at: _at, ...i }) => i as FeedItem)];
}

export function unreadCount(events: readonly { readAt: string | null }[], anns: readonly { read: boolean }[]): number {
  return events.filter((e) => !e.readAt).length + anns.filter((a) => !a.read).length;
}

// ── Links ───────────────────────────────────────────────────────────────────

/**
 * Notifications store the in-app path. The employee portal has its own pages
 * for some of them; a page it does not have is shown without a link rather
 * than one that would 403 (an employee login is confined to /my-time).
 */
const PORTAL_PATHS: Record<string, string> = {
  "/resources/my-time": "/my-time",
  "/resources/my-dashboard": "/my-time/dashboard",
  "/resources/my-details": "/my-time/details",
  "/resources/my-reports": "/my-time/reports",
  "/resources/approvals": "/my-time/approvals",
  "/resources/reports": "/my-time/team",
  "/resources/notifications": "/my-time/notifications",
};
export function portalHref(href: string | null): string | null {
  if (!href) return null;
  const [path, query] = href.split("?");
  const mapped = PORTAL_PATHS[path];
  return mapped ? (query ? `${mapped}?${query}` : mapped) : null;
}

// ── Attention ───────────────────────────────────────────────────────────────

export interface AttentionCounts { approvals: number; returns: number; enquiries: number }
export interface AttentionItem { key: keyof AttentionCounts; label: string; count: number; href: string }

/** The live "needs your attention" lines, only those with something in them. */
export function attentionItems(c: AttentionCounts): AttentionItem[] {
  const out: AttentionItem[] = [];
  if (c.returns > 0) out.push({ key: "returns", count: c.returns, href: "/resources/my-time",
    label: c.returns === 1 ? "1 timesheet line returned to you" : `${c.returns} timesheet lines returned to you` });
  if (c.approvals > 0) out.push({ key: "approvals", count: c.approvals, href: "/resources/approvals",
    label: c.approvals === 1 ? "1 timesheet line waiting for your approval" : `${c.approvals} timesheet lines waiting for your approval` });
  if (c.enquiries > 0) out.push({ key: "enquiries", count: c.enquiries, href: "/resources/enquiries",
    label: c.enquiries === 1 ? "1 hours-over-plan enquiry to answer" : `${c.enquiries} hours-over-plan enquiries to answer` });
  return out;
}
