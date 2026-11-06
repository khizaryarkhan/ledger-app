"use client";

/**
 * Notifications — one feed for the app and the employee portal.
 *
 * Top: what needs you now (live counts, never stored). Below: announcements an
 * admin posted and events addressed to you, pinned first then newest first.
 * Opening an item marks it read; "Mark all read" clears the badge.
 *
 * Org admins also get "New announcement" and a Manage view (edit, remove, see
 * how many have read each). Standalone (no data-provider) so it runs in the
 * employee portal, whose logins may only reach /api/resources/me/**.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, Megaphone, Pin, Undo2, MessageSquareReply, Scale, CheckCheck, Plus, Pencil, Trash2, ArrowRight } from "lucide-react";
import { ReportShell, type ReportShellKind } from "@/components/resource-report-shell";
import { Drawer, DrawerFooter, Field, controlInset, controlMultiline, tableHead } from "@/components/form-kit";
import { formatDateShort, localToday } from "@/lib/format";
import { portalHref, type FeedItem, type AttentionItem } from "@/lib/notifications/rules";

interface Feed { items: FeedItem[]; unread: number; attention: AttentionItem[] }
interface AdminRow {
  id: string; title: string; body: string; pinned: boolean; publishedAt: string; expiresOn: string | null;
  authorName: string | null; live: boolean; readCount: number;
}
type Draft = { id: string | null; title: string; body: string; pinned: boolean; expiresOn: string };

/** A real instant (created/published), shown in the viewer's own time zone. */
function when(isoInstant: string): string {
  const d = new Date(isoInstant);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const EVENT_ICON: Record<string, typeof Bell> = { time_returned: Undo2, return_reply: MessageSquareReply, enquiry_assigned: Scale };

export function NotificationsFeed({ shell }: { shell: ReportShellKind }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [isAdmin, setIsAdmin] = useState(false);
  const [manage, setManage] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const link = useCallback((href: string | null) => (shell === "portal" ? portalHref(href) : href), [shell]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/resources/me/notifications");
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || !Array.isArray(d.items)) { setErr(d?.error || "Could not load notifications"); return; }
      setErr(null); setFeed(d);
    } catch { setErr("Network problem. Reload to try again."); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (shell === "portal") return; // admins manage announcements from the app, not the timesheet portal
    fetch("/api/resources/me").then((r) => (r.ok ? r.json() : null)).then((d) => setIsAdmin(!!d?.isOrgAdmin)).catch(() => {});
  }, [shell]);

  async function mark(body: Record<string, unknown>) {
    await fetch("/api/resources/me/notifications", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).catch(() => {});
    load();
  }

  function openItem(i: FeedItem) {
    setOpen((o) => (o === `${i.type}:${i.id}` ? null : `${i.type}:${i.id}`));
    const unread = i.type === "event" ? !i.readAt : !i.read;
    if (unread) mark(i.type === "event" ? { eventIds: [i.id] } : { announcementIds: [i.id] });
  }

  const shown = useMemo(() => {
    const items = feed?.items ?? [];
    return filter === "all" ? items : items.filter((i) => (i.type === "event" ? !i.readAt : !i.read));
  }, [feed, filter]);

  const actions = (
    <div className="flex items-center gap-2">
      <div className="flex rounded-md ring-1 ring-stone-700 overflow-hidden">
        {(["all", "unread"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`h-8 px-3 text-[12px] ${filter === f ? "bg-stone-700 text-stone-100" : "bg-stone-800 text-stone-400 hover:text-stone-200"}`}>
            {f === "all" ? "All" : `Unread${feed?.unread ? ` (${feed.unread})` : ""}`}
          </button>
        ))}
      </div>
      <button onClick={() => mark({ all: true })} disabled={!feed?.unread}
        className="h-8 px-3 rounded-md ring-1 ring-stone-700 bg-stone-800 text-[12px] text-stone-300 hover:text-stone-100 flex items-center gap-1.5 disabled:opacity-40">
        <CheckCheck size={13} /> Mark all read
      </button>
      {isAdmin && (
        <>
          <button onClick={() => setManage((m) => !m)}
            className={`h-8 px-3 rounded-md ring-1 text-[12px] ${manage ? "ring-stone-600 bg-stone-700 text-stone-100" : "ring-stone-700 bg-stone-800 text-stone-400 hover:text-stone-200"}`}>
            Manage announcements
          </button>
          <button onClick={() => setDraft({ id: null, title: "", body: "", pinned: false, expiresOn: "" })}
            className="h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold flex items-center gap-1.5">
            <Plus size={13} /> New announcement
          </button>
        </>
      )}
    </div>
  );

  return (
    <ReportShell shell={shell} title="Notifications" subtitle="What needs you now, company announcements, and what has happened to your work." actions={actions}>
      {err && <p className="text-[13px] text-rose-400 mb-3">{err}</p>}
      {!feed && !err && <p className="text-[13px] text-stone-500">Loading...</p>}

      {feed && feed.attention.length > 0 && (
        <section className="mb-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">Needs your attention</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {feed.attention.map((a) => {
              const href = link(a.href);
              const body = (
                <div className="flex items-center gap-3 rounded-lg border border-amber-800/40 bg-amber-500/5 px-3 py-2.5">
                  <span className="text-[18px] font-semibold tabular-nums text-amber-300">{a.count}</span>
                  <span className="flex-1 text-[13px] text-stone-200">{a.label}</span>
                  {href && <ArrowRight size={14} className="text-stone-500" />}
                </div>
              );
              return href ? <Link key={a.key} href={href} className="hover:opacity-90">{body}</Link> : <div key={a.key}>{body}</div>;
            })}
          </div>
        </section>
      )}

      {manage && isAdmin && <ManageAnnouncements onEdit={(r) => setDraft({ id: r.id, title: r.title, body: r.body, pinned: r.pinned, expiresOn: r.expiresOn ?? "" })} onChanged={load} />}

      {feed && !manage && (
        shown.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-800 p-10 text-center text-[13px] text-stone-500">
            {filter === "unread" ? "Nothing unread." : "Nothing here yet. Returned time, replies, enquiries and announcements will appear here."}
          </div>
        ) : (
          <ul className="rounded-lg border border-stone-800 divide-y divide-stone-800/70">
            {shown.map((i) => {
              const key = `${i.type}:${i.id}`;
              const unread = i.type === "event" ? !i.readAt : !i.read;
              const Icon = i.type === "announcement" ? (i.pinned ? Pin : Megaphone) : (EVENT_ICON[i.kind] ?? Bell);
              const href = i.type === "event" ? link(i.href) : null;
              const at = i.type === "event" ? i.createdAt : i.publishedAt;
              const body = i.body;
              const expanded = open === key;
              return (
                <li key={key} className={unread ? "bg-stone-900/60" : ""}>
                  <button onClick={() => openItem(i)} className="w-full text-left px-4 py-3 flex items-start gap-3">
                    <Icon size={15} className={`mt-0.5 shrink-0 ${unread ? "text-pink-300" : "text-stone-500"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {unread && <span className="h-1.5 w-1.5 rounded-full bg-pink-400 shrink-0" aria-label="Unread" />}
                        <span className={`text-[13px] truncate ${unread ? "text-stone-100 font-medium" : "text-stone-300"}`}>{i.title}</span>
                        {i.type === "announcement" && <span className="text-[10px] uppercase tracking-wider text-stone-500 shrink-0">Announcement</span>}
                      </div>
                      {body && (
                        <p className={`text-[12px] text-stone-400 mt-0.5 whitespace-pre-wrap ${expanded ? "" : "line-clamp-2"}`}>{body}</p>
                      )}
                      <div className="text-[11px] text-stone-500 mt-1 flex items-center gap-2">
                        <span>{when(at)}</span>
                        {i.type === "announcement" && i.authorName && <span>· {i.authorName}</span>}
                        {i.type === "announcement" && i.expiresOn && <span>· until {formatDateShort(i.expiresOn)}</span>}
                      </div>
                    </div>
                  </button>
                  {href && expanded && (
                    <div className="px-11 pb-3 -mt-1">
                      <Link href={href} className="text-[12px] text-pink-300 hover:text-pink-200 inline-flex items-center gap-1">Open <ArrowRight size={12} /></Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )
      )}

      {draft && <AnnouncementDrawer draft={draft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); load(); }} />}
    </ReportShell>
  );
}

function ManageAnnouncements({ onEdit, onChanged }: { onEdit: (r: AdminRow) => void; onChanged: () => void }) {
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/resources/announcements").catch(() => null);
    const d = r ? await r.json().catch(() => null) : null;
    if (!r?.ok || !Array.isArray(d)) { setErr(d?.error || "Could not load announcements"); setRows([]); return; }
    setErr(null); setRows(d);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function remove(id: string) {
    if (!confirm("Remove this announcement for everyone?")) return;
    const r = await fetch(`/api/resources/announcements/${id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not remove it"); return; }
    load(); onChanged();
  }

  if (!rows) return <p className="text-[13px] text-stone-500">Loading...</p>;
  return (
    <div className="mb-5">
      {err && <p className="text-[13px] text-rose-400 mb-2">{err}</p>}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-800 p-8 text-center text-[13px] text-stone-500">No announcements yet.</div>
      ) : (
        <table className="w-full text-[13px] rounded-lg border border-stone-800">
          <thead>
            <tr className={`text-left ${tableHead}`}>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Posted</th>
              <th className="px-3 py-2 font-medium">Shown until</th>
              <th className="px-3 py-2 font-medium text-right">Read by</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-stone-800/60">
                <td className="px-3 py-2 text-stone-100">{r.pinned && <Pin size={11} className="inline mr-1 text-pink-300" />}{r.title}</td>
                <td className="px-3 py-2 text-stone-400">{when(r.publishedAt)}{r.authorName ? ` · ${r.authorName}` : ""}</td>
                <td className="px-3 py-2 text-stone-400">{r.expiresOn ? formatDateShort(r.expiresOn) : "Until removed"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-stone-300">{r.readCount}</td>
                <td className="px-3 py-2">{r.live ? <span className="text-stone-300">Showing</span> : <span className="text-stone-500">Ended</span>}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => onEdit(r)} aria-label="Edit" className="p-1.5 text-stone-500 hover:text-stone-200"><Pencil size={13} /></button>
                  <button onClick={() => remove(r.id)} aria-label="Remove" className="p-1.5 text-stone-500 hover:text-rose-400"><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AnnouncementDrawer({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Draft>(draft);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setSaving(true); setErr("");
    try {
      const r = await fetch(form.id ? `/api/resources/announcements/${form.id}` : "/api/resources/announcements", {
        method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: form.title, body: form.body, pinned: form.pinned, expiresOn: form.expiresOn || null, today: localToday() }),
      });
      if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save"); return; }
      onSaved();
    } catch { setErr("Network problem. Try again."); } finally { setSaving(false); }
  }

  return (
    <Drawer title={form.id ? "Edit announcement" : "New announcement"} subtitle="Shown to everyone in the organisation, in their Notifications."
      onClose={onClose}
      footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} err={err} saveLabel={form.id ? "Save" : "Publish"}
        saveDisabled={!form.title.trim() || !form.body.trim()} />}>
      <div className="space-y-4">
        <Field label="Title" required>
          <input value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} className={controlInset} />
        </Field>
        <Field label="Text" required hint="Plain text. Line breaks are kept.">
          <textarea value={form.body} rows={8} maxLength={10000} onChange={(e) => setForm({ ...form, body: e.target.value })} className={controlMultiline} />
        </Field>
        <Field label="Show until" hint="Optional. The last day it is shown; leave empty to keep it until you remove it.">
          <input type="date" value={form.expiresOn} min={localToday()} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} className={controlInset} />
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-stone-300">
          <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />
          Pin to the top of everyone&apos;s notifications
        </label>
      </div>
    </Drawer>
  );
}
