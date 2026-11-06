import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  parseAnnouncement, isLive, expiresAtFor, expiryDay, mergeFeed, unreadCount, portalHref, attentionItems,
  type FeedEvent, type FeedAnnouncement,
} from "@/lib/notifications/rules";
import { isSensitiveRoute } from "@/lib/mcp/policy";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const TODAY = "2026-11-06";

describe("announcements", () => {
  it("need a title and some text", () => {
    expect(parseAnnouncement({ title: " ", body: "x" }, TODAY).ok).toBe(false);
    expect(parseAnnouncement({ title: "x", body: "" }, TODAY).ok).toBe(false);
    expect(parseAnnouncement({ title: "Office closed", body: "Friday" }, TODAY))
      .toEqual({ ok: true, value: { title: "Office closed", body: "Friday", pinned: false, expiresOn: null } });
  });
  it("refuse an end date in the past or an impossible one, accept today", () => {
    expect(parseAnnouncement({ title: "a", body: "b", expiresOn: "2026-11-05" }, TODAY).ok).toBe(false);
    expect(parseAnnouncement({ title: "a", body: "b", expiresOn: "2026-02-30" }, TODAY).ok).toBe(false);
    const ok = parseAnnouncement({ title: "a", body: "b", expiresOn: TODAY, pinned: true }, TODAY);
    expect(ok.ok && ok.value).toEqual({ title: "a", body: "b", pinned: true, expiresOn: TODAY });
  });
  it("are shown through the whole of their last day, and the day round-trips", () => {
    const at = expiresAtFor("2026-11-06");
    expect(expiryDay(at)).toBe("2026-11-06");
    expect(isLive({ publishedAt: "2026-11-01T09:00:00Z", expiresAt: at }, new Date("2026-11-06T22:00:00Z"))).toBe(true);
    expect(isLive({ publishedAt: "2026-11-01T09:00:00Z", expiresAt: at }, new Date("2026-11-07T00:00:01Z"))).toBe(false);
    expect(isLive({ publishedAt: "2026-11-09T09:00:00Z", expiresAt: null }, new Date("2026-11-06T00:00:00Z"))).toBe(false);
  });
});

describe("the feed", () => {
  const ev = (id: string, createdAt: string, readAt: string | null = null): FeedEvent =>
    ({ id, kind: "time_returned", title: id, body: null, href: "/resources/my-time", createdAt, readAt });
  const ann = (id: string, publishedAt: string, pinned = false, read = false): FeedAnnouncement =>
    ({ id, title: id, body: "b", pinned, publishedAt, expiresOn: null, authorName: null, read });

  it("puts pinned announcements first, then everything newest first", () => {
    const items = mergeFeed(
      [ev("e-old", "2026-11-01T10:00:00Z"), ev("e-new", "2026-11-05T10:00:00Z")],
      [ann("a-mid", "2026-11-03T10:00:00Z"), ann("a-pin", "2026-10-01T10:00:00Z", true)],
    );
    expect(items.map((i) => i.id)).toEqual(["a-pin", "e-new", "a-mid", "e-old"]);
  });
  it("counts unread events and unread announcements", () => {
    expect(unreadCount([ev("1", "x"), ev("2", "x", "read")], [ann("a", "x"), ann("b", "x", false, true)])).toBe(2);
  });
  it("only lists attention lines that have something in them", () => {
    expect(attentionItems({ approvals: 0, returns: 0, enquiries: 0 })).toEqual([]);
    const a = attentionItems({ approvals: 3, returns: 1, enquiries: 0 });
    expect(a.map((x) => x.label)).toEqual(["1 timesheet line returned to you", "3 timesheet lines waiting for your approval"]);
  });
  it("maps links into the employee portal, and drops one it has no page for", () => {
    expect(portalHref("/resources/my-time")).toBe("/my-time");
    expect(portalHref("/resources/approvals")).toBe("/my-time/approvals");
    expect(portalHref("/resources/enquiries")).toBeNull();
    expect(portalHref(null)).toBeNull();
  });
});

describe("wiring", () => {
  it("returned time notifies the person, after the thread exists", () => {
    const s = src("lib/resources/approval-server.ts");
    const insert = s.indexOf("db.insert(timesheetReturns)");
    const n = s.indexOf('kind: "time_returned"');
    expect(insert).toBeGreaterThan(-1);
    expect(n).toBeGreaterThan(insert);
  });
  it("a reply notifies whoever returned the time, only when there is a reply", () => {
    expect(src("lib/resources/approval-server.ts")).toMatch(/if \(response !== null && rows\[0\]\.returnedBy\)/);
  });
  it("an enquiry notifies its answerer only when the row was really inserted (a re-run notifies nobody)", () => {
    const s = src("lib/resources/variance-server.ts");
    expect(s).toMatch(/await notify\(orgId, inserted\.flatMap/);
  });
  it("notify can never fail the thing it reports", () => {
    const s = src("lib/notifications/notify.ts");
    expect(s).toMatch(/try \{\s*await db\.insert\(notifications\)/);
    expect(s).toMatch(/\.onConflictDoNothing\(\)/);
  });
  it("the feed is the caller's own: employee-reachable, user from the session, never the body", () => {
    const r = src("app/api/resources/me/notifications/route.ts");
    expect(r).toMatch(/requireOrg\(\{ allowEmployee: true \}\)/);
    expect(r).toMatch(/const userId = \(session\?\.user as any\)\?\.id/);
    expect(r).not.toMatch(/body\??\.userId/);
    expect(src("lib/notifications/server.ts")).toMatch(/eq\(notifications\.userId, userId\), inArray\(notifications\.id, ev\)/);
  });
  it("only org admins post, edit or remove announcements", () => {
    for (const f of ["app/api/resources/announcements/route.ts", "app/api/resources/announcements/[id]/route.ts"]) {
      expect(src(f), f).toMatch(/if \(!isAdminRole\(r\.role\)\) return \{ error: bad\(/);
    }
  });
  it("an AI connection needs the 'sensitive' grant to post to everyone", () => {
    expect(isSensitiveRoute("/api/resources/announcements")).toBe(true);
    expect(isSensitiveRoute("/api/resources/announcements/abc")).toBe(true);
    expect(isSensitiveRoute("/api/resources/me/notifications")).toBe(false);
  });
  it("the attention count and the approvals queue are the same set", () => {
    const s = src("lib/resources/time-entries-server.ts");
    expect(s).toMatch(/export async function approvalCount[\s\S]*?decidableSubmitted\(ctx\)/);
    expect(s).toMatch(/export async function approvalQueue[\s\S]*?decidableSubmitted\(ctx\)/);
  });
});
