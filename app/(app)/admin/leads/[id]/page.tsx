"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PIPELINE_STAGES, OFF_PIPELINE, isDealStage, stageLabel } from "@/lib/pipeline";
import {
  ArrowLeft, Mail, StickyNote, CheckSquare, Trophy, Phone, Zap, Loader,
  Building2, Globe, Send, Plus, Clock, MessageSquare, ChevronDown, Filter,
  Sparkles, Users, Calendar, Trash2, Heart, CornerUpLeft, X,
} from "lucide-react";

const STATUS = [...PIPELINE_STAGES, ...OFF_PIPELINE].map(s => s.key);
const STATUS_LABEL = Object.fromEntries([...PIPELINE_STAGES, ...OFF_PIPELINE].map(s => [s.key, s.label])) as Record<string, string>;

function money(v: number, ccy = "USD") {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(v || 0); } catch { return `${ccy} ${v}`; }
}
function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// A note row may be plain text, a logged email, or a call disposition.
function parseActivity(n: any) {
  try {
    const j = JSON.parse(n.body);
    if (j && j._type === "email") return { kind: "email", ...j, raw: n };
  } catch {}
  const body: string = n.body ?? "";
  if (body.startsWith("Call —")) return { kind: "call", text: body, raw: n };
  return { kind: "note", text: body, raw: n };
}

export default function LeadWorkspace() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [lead, setLead] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [inbound, setInbound] = useState<any[]>([]);
  const [account, setAccount] = useState<any>(null);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [sequences, setSequences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"note" | "email">("note");
  const [filter, setFilter] = useState<"all" | "email" | "note" | "call">("all");
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [reader, setReader] = useState<any>(null);   // email being viewed
  const [compose, setCompose] = useState<any>(null); // {to, cc, bcc, subject, body}
  const [savingStatus, setSavingStatus] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetch(`/api/admin/leads/${id}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/admin/leads/${id}/notes`).then(r => r.ok ? r.json() : []),
      fetch(`/api/admin/leads/${id}/tasks`).then(r => r.ok ? r.json() : []),
      fetch(`/api/admin/leads/${id}/enrollments`).then(r => r.ok ? r.json() : []),
      fetch(`/api/admin/sequences`).then(r => r.ok ? r.json() : []),
      fetch(`/api/admin/leads/${id}/contacts`).then(r => r.ok ? r.json() : { contacts: [] }),
    ]).then(([l, n, t, e, s, c]) => {
      setLead(l); setNotes(Array.isArray(n) ? n : []); setTasks(Array.isArray(t) ? t : []);
      setEnrollments(Array.isArray(e) ? e : []);
      setSequences((Array.isArray(s) ? s : []).filter((x: any) => x.isActive));
      setContacts(c.contacts ?? []);
    }).finally(() => setLoading(false));
    // Inbound replies are pulled live from the connected mailbox (slower) — load separately.
    fetch(`/api/admin/leads/${id}/emails`).then(r => r.ok ? r.json() : { emails: [] })
      .then(d => setInbound(Array.isArray(d.emails) ? d.emails : [])).catch(() => {});
    // Account 360 billing facet (org / subscription / invoices).
    fetch(`/api/admin/leads/${id}/account`).then(r => r.ok ? r.json() : null).then(setAccount).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); } }, [toast]);

  // Build the timeline: emails grouped into threads by subject; notes/calls
  // stay as individual entries. Everything sorted by most-recent activity.
  const timeline = useMemo(() => {
    const parsed = notes.map(parseActivity).map(a => ({ ...a, at: a.raw.createdAt, author: a.raw.authorName }));
    const emails: any[] = [];
    const others: any[] = [];
    for (const a of parsed) {
      if (a.kind === "email") emails.push({ direction: "out", subject: a.subject, who: a.to, at: a.at, preview: a.preview, sequence: a.sequence });
      else others.push({ type: "item", kind: a.kind, text: a.text, author: a.author, at: a.at });
    }
    for (const m of inbound) emails.push({ direction: "in", subject: m.subject, who: m.fromName || m.from, from: m.from, at: m.date, uid: m.uid });

    // group emails by normalised subject
    const norm = (s: string) => (s || "(no subject)").replace(/^((re|fwd|fw)\s*:\s*)+/i, "").trim().toLowerCase();
    const byKey = new Map<string, any>();
    for (const e of emails) {
      const k = norm(e.subject);
      if (!byKey.has(k)) byKey.set(k, { type: "thread", subject: e.subject.replace(/^((re|fwd|fw)\s*:\s*)+/i, ""), msgs: [], at: e.at });
      const th = byKey.get(k);
      th.msgs.push(e);
      if (new Date(e.at).getTime() > new Date(th.at).getTime()) th.at = e.at;
    }
    for (const th of byKey.values()) th.msgs.sort((a: any, b: any) => new Date(b.at).getTime() - new Date(a.at).getTime());

    let merged = [...byKey.values(), ...others].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    if (filter === "email") merged = merged.filter(x => x.type === "thread");
    else if (filter !== "all") merged = merged.filter(x => x.type === "item" && x.kind === filter);
    return merged;
  }, [notes, inbound, filter]);

  const activeEnrollment = enrollments.find(e => e.status === "active");

  // Computed "AI" insight from the lead's own relational data — deterministic
  // today, an easy upgrade to an LLM summary later (same slot).
  const insight = useMemo(() => {
    const isEmail = (n: any) => { try { return JSON.parse(n.body)?._type === "email"; } catch { return false; } };
    const emails = notes.filter(isEmail).length;
    const dealActive = !!lead && isDealStage(lead.status);
    const engagement = Math.min(100, notes.length * 14);
    let next = "No activity yet — send an intro email to open the conversation.";
    if (dealActive) next = `Advance this deal - currently in ${stageLabel(lead.status)}.`;
    if (activeEnrollment) next = `Enrolled in “${activeEnrollment.sequenceName}” — watch for a reply, then call.`;
    return { emails, engagement, next, dealActive };
  }, [notes, lead, activeEnrollment]);

  const setStatus = async (status: string) => {
    setSavingStatus(true);
    setLead((l: any) => ({ ...l, status }));
    await fetch(`/api/admin/leads/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    setSavingStatus(false); setToast({ ok: true, msg: `Marked ${STATUS_LABEL[status]}` });
  };

  if (loading) return <div className="max-w-6xl mx-auto"><div className="h-24 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse mb-4" /><div className="grid grid-cols-3 gap-4">{[1,2,3].map(i => <div key={i} className="h-80 bg-stone-900/40 border border-stone-800 rounded-xl animate-pulse" />)}</div></div>;
  if (!lead) return <div className="max-w-3xl mx-auto py-20 text-center text-stone-500">Lead not found. <Link href="/admin/leads" className="text-emerald-400">Back to Leads</Link></div>;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-start gap-3 min-w-0">
          <button onClick={() => router.push("/admin/leads")} className="mt-1 p-1.5 rounded-lg hover:bg-stone-800 text-stone-500"><ArrowLeft size={16} /></button>
          <div className="w-11 h-11 rounded-xl bg-stone-800 flex items-center justify-center text-sm font-semibold text-stone-300 shrink-0">{(lead.companyName || lead.fullName || "?").slice(0, 2).toUpperCase()}</div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white truncate">{lead.companyName || lead.fullName}</h1>
            <p className="text-[13px] text-stone-500 truncate">{lead.companyName ? lead.fullName : lead.email}{lead.interestedService ? ` · ${lead.interestedService}` : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <select value={lead.status} onChange={e => setStatus(e.target.value)} disabled={savingStatus}
              className="appearance-none h-9 pl-3 pr-8 text-xs font-medium rounded-lg bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500">
              {STATUS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Quick action bar */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {[
          { label: "Email", icon: Mail, onClick: () => setCompose({ to: lead.email, cc: "", bcc: "", subject: "", body: "" }) },
          { label: "Note", icon: StickyNote, onClick: () => setTab("note") },
          { label: "Call", icon: Phone, soon: true },
          { label: "SMS", icon: MessageSquare, soon: true },
          { label: "Meeting", icon: Calendar, soon: true },
        ].map(a => (
          <button key={a.label} onClick={a.onClick} disabled={(a as any).soon}
            title={(a as any).soon ? "Coming soon" : undefined}
            className={`flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border transition-colors ${(a as any).soon ? "border-stone-800 text-stone-600 cursor-default" : "border-stone-700 text-stone-200 hover:bg-stone-800"}`}>
            <a.icon size={13} /> {a.label}
          </button>
        ))}
      </div>

      {/* Won → customer banner */}
      {lead.status === "converted" && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] p-3.5 flex items-center gap-2.5">
          <Trophy size={15} className="text-emerald-400 shrink-0" />
          <p className="text-[13px] text-emerald-300 flex-1">This company is <b>won</b>. It now belongs in Accounts until an invoice or subscription is created.</p>
          <Link href="/admin/accounts" className="text-[12px] font-medium text-emerald-300 hover:text-emerald-200 whitespace-nowrap">Open Accounts</Link>
        </div>
      )}

      {/* AI summary strip */}
      <div className="mb-4 rounded-xl border border-violet-500/25 bg-violet-500/[0.06] p-3.5">
        <div className="flex items-center gap-1.5 mb-1.5"><Sparkles size={13} className="text-violet-300" /><span className="text-[11px] font-semibold text-violet-300 uppercase tracking-wider">AI summary</span>
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-stone-400"><Heart size={11} className="text-emerald-400" /> Engagement {insight.engagement}</span>
        </div>
        <p className="text-[13px] text-stone-300 leading-relaxed"><span className="text-stone-400">Next best action — </span>{insight.next}</p>
        {lead.status !== "converted" && !insight.dealActive && (
          <button onClick={() => setStatus("proposal")} disabled={savingStatus}
            className="mt-2.5 inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-semibold rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-stone-700 text-white transition-colors">
            {savingStatus ? <Loader size={12} className="animate-spin" /> : <Trophy size={13} />} Start deal stage
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-5">
        {/* ── Left: about + contacts + opportunities + tasks + sequence ── */}
        <div className="space-y-4">
          <Panel title="About">
            <Field label="Company" value={lead.companyName || "—"} />
            <Field label="Country" value={lead.country || "—"} />
            <Field label="Service" value={lead.interestedService || "—"} />
            <Field label="Source" value={lead.source === "manual" ? "Manual" : "Website"} />
            <Field label="Received" value={new Date(lead.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} />
          </Panel>

          <AccountPanel lead={lead} account={account} />

          <ContactsPanel leadId={id} contacts={contacts} onChange={load} onToast={setToast} />

          <DealPanel lead={lead} onChange={load} onToast={setToast} />

          <TasksPanel leadId={id} tasks={tasks} onChange={load} onToast={setToast} />

          <SequencePanel leadId={id} active={activeEnrollment} sequences={sequences} onChange={load} onToast={setToast} />
        </div>

        {/* ── Right: composer + activity timeline ── */}
        <div className="space-y-4 min-w-0">
          <Composer leadId={id} lead={lead} onSent={load} onToast={setToast}
            onCompose={() => setCompose({ to: lead.email, cc: "", bcc: "", subject: "", body: "" })} />

          <Panel title="Activity" right={
            <div className="flex items-center gap-1">
              <Filter size={11} className="text-stone-600" />
              {(["all", "email", "note", "call"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} className={`text-[11px] px-1.5 py-0.5 rounded ${filter === f ? "bg-stone-700 text-white" : "text-stone-500 hover:text-stone-300"}`}>{f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}</button>
              ))}
            </div>
          }>
            {timeline.length === 0 ? (
              <p className="text-[13px] text-stone-600 py-6 text-center">No activity yet. Log a note or send an email above.</p>
            ) : (
              <div className="space-y-3">
                {timeline.map((x, i) => x.type === "thread"
                  ? <EmailThread key={i} thread={x} onOpen={setReader} />
                  : <ActivityItem key={i} a={x} />)}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {reader && (
        <EmailReader email={reader} onClose={() => setReader(null)}
          onReply={(all: boolean) => { const c = buildReply(reader, all, lead); setReader(null); setCompose(c); }} />
      )}
      {compose && (
        <ComposeModal leadId={id} initial={compose} onClose={() => setCompose(null)}
          onSent={() => { setCompose(null); load(); setToast({ ok: true, msg: "Email sent" }); }} onToast={setToast} />
      )}

      {toast && <div className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-xl ${toast.ok ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{toast.msg}</div>}
    </div>
  );
}

// Build a reply / reply-all draft from a viewed email.
function buildReply(email: any, all: boolean, lead: any) {
  const to = email.from || email.fullFrom || lead?.email || "";
  const cc = all ? (email.fullCc || "") : "";
  const subj = /^re:/i.test(email.subject || "") ? email.subject : `Re: ${email.subject || ""}`;
  const when = email.at ? new Date(email.at).toLocaleString() : "";
  const quote = `\n\n———\nOn ${when}, ${email.who || to} wrote:\n${(email.bodyText || email.preview || "").slice(0, 1500)}`;
  return { to, cc, bcc: "", subject: subj, body: quote };
}

// ── Building blocks ───────────────────────────────────────────────────────────
function Panel({ title, right, children }: { title: string; right?: any; children: any }) {
  return (
    <div className="rounded-xl border border-stone-800 bg-stone-900/40">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800">
        <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">{title}</span>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
function Field({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 py-1 text-[13px]"><span className="text-stone-500 shrink-0">{label}</span><span className="text-stone-300 text-right truncate">{value}</span></div>;
}

function ActivityItem({ a }: { a: any }) {
  if (a.kind === "email") {
    if (a.inbound) {
      return (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-3">
          <div className="flex items-center gap-2 mb-1"><CornerUpLeft size={12} className="text-emerald-400" /><span className="text-[11px] font-medium text-emerald-300">Reply from {a.author}</span><span className="ml-auto text-[10px] text-stone-600">{timeAgo(a.at)}</span></div>
          <p className="text-[13px] font-medium text-stone-200">{a.subject}</p>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-stone-800 bg-stone-900/60 p-3">
        <div className="flex items-center gap-2 mb-1"><Mail size={12} className="text-sky-400" /><span className="text-[11px] font-medium text-sky-300">Email{a.sequence ? ` · ${a.sequence}` : ""}</span><span className="ml-auto text-[10px] text-stone-600">{timeAgo(a.at)}</span></div>
        <p className="text-[13px] font-medium text-stone-200">{a.subject}</p>
        <p className="text-[12px] text-stone-500 mt-0.5">To {a.to}</p>
        {a.preview && <p className="text-[12px] text-stone-400 mt-1 line-clamp-3 whitespace-pre-wrap">{a.preview}</p>}
      </div>
    );
  }
  if (a.kind === "call") {
    return (
      <div className="rounded-lg border border-stone-800 bg-stone-900/60 p-3">
        <div className="flex items-center gap-2"><Phone size={12} className="text-emerald-400" /><span className="text-[13px] text-stone-300">{a.text}</span><span className="ml-auto text-[10px] text-stone-600">{timeAgo(a.at)}</span></div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900/60 p-3">
      <div className="flex items-center gap-2 mb-1"><StickyNote size={12} className="text-amber-400" /><span className="text-[11px] font-medium text-amber-300/90">{a.author || "Note"}</span><span className="ml-auto text-[10px] text-stone-600">{timeAgo(a.at)}</span></div>
      <p className="text-[13px] text-stone-300 whitespace-pre-wrap">{a.text}</p>
    </div>
  );
}

// ── Composer (note inline; email opens the full modal) ───────────────────────────
function Composer({ leadId, lead, onSent, onToast, onCompose }: any) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const saveNote = async () => {
    if (!note.trim()) return; setBusy(true);
    const r = await fetch(`/api/admin/leads/${leadId}/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: note.trim() }) });
    setBusy(false);
    if (r.ok) { setNote(""); onSent(); onToast({ ok: true, msg: "Note added" }); } else onToast({ ok: false, msg: "Failed" });
  };
  const inp = "w-full px-3 py-2 text-[13px] rounded-md bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";
  return (
    <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-3">
      <textarea className={`${inp} resize-none`} rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Log a note about this lead…" />
      <div className="flex justify-between items-center mt-2">
        <button onClick={onCompose} className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800"><Mail size={13} /> Compose email</button>
        <button onClick={saveNote} disabled={busy || !note.trim()} className="h-8 px-3.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 text-white flex items-center gap-1.5">{busy ? <Loader size={12} className="animate-spin" /> : <Plus size={12} />} Add note</button>
      </div>
    </div>
  );
}

// ── Email thread (emails grouped by subject) ─────────────────────────────────────
function EmailThread({ thread, onOpen }: { thread: any; onOpen: (m: any) => void }) {
  const [open, setOpen] = useState(thread.msgs.length <= 2);
  const shown = open ? thread.msgs : thread.msgs.slice(0, 1);
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900/60 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-3 py-2 border-b border-stone-800/70 text-left">
        <Mail size={12} className="text-sky-400 shrink-0" />
        <span className="text-[12.5px] font-medium text-stone-200 truncate flex-1">{thread.subject || "(no subject)"}</span>
        <span className="text-[10px] text-stone-500">{thread.msgs.length} msg{thread.msgs.length !== 1 ? "s" : ""}</span>
        <ChevronDown size={13} className={`text-stone-600 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div className="divide-y divide-stone-800/50">
        {shown.map((m: any, i: number) => (
          <button key={i} onClick={() => onOpen(m)} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-stone-800/40 text-left">
            {m.direction === "in"
              ? <CornerUpLeft size={12} className="text-emerald-400 shrink-0" />
              : <Send size={12} className="text-sky-400/80 shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] text-stone-300 truncate">{m.direction === "in" ? `Reply from ${m.who}` : `Sent to ${m.who}`}{m.sequence ? ` · ${m.sequence}` : ""}</p>
              {m.preview && <p className="text-[11px] text-stone-600 truncate">{m.preview}</p>}
            </div>
            <span className="text-[10px] text-stone-600 shrink-0">{timeAgo(m.at)}</span>
          </button>
        ))}
        {!open && thread.msgs.length > 1 && (
          <button onClick={() => setOpen(true)} className="w-full px-3 py-1.5 text-[11px] text-stone-500 hover:text-stone-300 text-left">+ {thread.msgs.length - 1} earlier</button>
        )}
      </div>
    </div>
  );
}

// ── Email reader (opens a full message; Reply / Reply all) ───────────────────────
function EmailReader({ email, onClose, onReply }: { email: any; onClose: () => void; onReply: (all: boolean) => void }) {
  const [full, setFull] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (email.uid != null) {
      setLoading(true);
      fetch(`/api/admin/email/messages/${email.uid}?mailbox=INBOX`).then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.message) { setFull(d.message); email.from = d.message.from?.text || email.from; email.fullCc = d.message.cc || ""; email.bodyText = d.message.text || ""; } })
        .catch(() => {}).finally(() => setLoading(false));
    }
  }, [email.uid]);
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-stone-900 rounded-xl w-full max-w-2xl ring-1 ring-stone-800 shadow-xl flex flex-col" style={{ maxHeight: "85vh" }} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-stone-800">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">{email.subject || "(no subject)"}</h2>
            <button onClick={onClose} className="text-stone-500 hover:text-stone-300 shrink-0"><X size={18} /></button>
          </div>
          <p className="text-[12px] text-stone-400 mt-1.5">{email.direction === "in" ? "From" : "To"} <span className="text-stone-300">{email.who}</span> · {email.at ? new Date(email.at).toLocaleString() : ""}</p>
          {full?.cc && <p className="text-[12px] text-stone-500">Cc {full.cc}</p>}
        </div>
        <div className="flex-1 overflow-auto">
          {loading ? <div className="flex items-center justify-center py-16"><Loader size={18} className="animate-spin text-stone-600" /></div>
            : full?.html ? <div className="bg-white"><iframe title="email" sandbox="" srcDoc={full.html} className="w-full border-0" style={{ height: "50vh" }} /></div>
            : <pre className="p-5 text-[13px] text-stone-300 whitespace-pre-wrap font-sans">{full?.text || email.preview || "(no preview available — open in Mail to read the full message)"}</pre>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-stone-800">
          <button onClick={() => onReply(false)} className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-stone-700 text-stone-200 hover:bg-stone-800"><CornerUpLeft size={13} /> Reply</button>
          <button onClick={() => onReply(true)} className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-stone-700 text-stone-200 hover:bg-stone-800"><Users size={13} /> Reply all</button>
        </div>
      </div>
    </div>
  );
}

// ── Compose / reply modal (To · Cc · Bcc · Subject · Body) ───────────────────────
function ComposeModal({ leadId, initial, onClose, onSent, onToast }: any) {
  const [to, setTo] = useState(initial.to || "");
  const [cc, setCc] = useState(initial.cc || "");
  const [bcc, setBcc] = useState(initial.bcc || "");
  const [showCcBcc, setShowCcBcc] = useState(!!(initial.cc || initial.bcc));
  const [subject, setSubject] = useState(initial.subject || "");
  const [body, setBody] = useState(initial.body || "");
  const [sending, setSending] = useState(false);
  const inp = "w-full px-3 py-2 text-[13px] rounded-md bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";

  const send = async () => {
    if (!to.trim()) { onToast({ ok: false, msg: "Recipient required" }); return; }
    if (!subject.trim() || !body.trim()) { onToast({ ok: false, msg: "Subject and body required" }); return; }
    setSending(true);
    try {
      const r = await fetch(`/api/admin/leads/${leadId}/email`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, cc, bcc, subject, body }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) onSent(); else onToast({ ok: false, msg: d.error ?? "Send failed" });
    } catch { onToast({ ok: false, msg: "Send failed" }); } finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-stone-900 rounded-xl w-full max-w-2xl ring-1 ring-stone-800 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-800">
          <h2 className="text-sm font-semibold text-white">New email</h2>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-300"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-stone-500 w-10 shrink-0">To</span>
            <input className={inp} value={to} onChange={e => setTo(e.target.value)} placeholder="recipient@email.com" />
            {!showCcBcc && <button onClick={() => setShowCcBcc(true)} className="text-[11px] text-stone-500 hover:text-stone-300 shrink-0">Cc/Bcc</button>}
          </div>
          {showCcBcc && (
            <>
              <div className="flex items-center gap-2"><span className="text-[11px] text-stone-500 w-10 shrink-0">Cc</span><input className={inp} value={cc} onChange={e => setCc(e.target.value)} placeholder="comma-separated" /></div>
              <div className="flex items-center gap-2"><span className="text-[11px] text-stone-500 w-10 shrink-0">Bcc</span><input className={inp} value={bcc} onChange={e => setBcc(e.target.value)} placeholder="comma-separated" /></div>
            </>
          )}
          <div className="flex items-center gap-2"><span className="text-[11px] text-stone-500 w-10 shrink-0">Subject</span><input className={inp} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" /></div>
          <textarea className={`${inp} resize-none`} rows={9} value={body} onChange={e => setBody(e.target.value)} placeholder="Write your message…" />
          <p className="text-[11px] text-emerald-400/80">Sends from your connected mailbox.</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-stone-800">
          <button onClick={onClose} className="h-9 px-4 text-xs font-medium rounded-lg text-stone-400 hover:bg-stone-800">Discard</button>
          <button onClick={send} disabled={sending} className="h-9 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 text-white flex items-center gap-1.5">{sending ? <Loader size={13} className="animate-spin" /> : <Send size={13} />} Send</button>
        </div>
      </div>
    </div>
  );
}

// Deal panel - edits the lead's own deal fields; no separate opportunity object.
function DealPanel({ lead, onChange, onToast }: any) {
  const [editing, setEditing] = useState(false);
  const [stage, setStage] = useState(isDealStage(lead.status) ? lead.status : "proposal");
  const [value, setValue] = useState(lead.value != null ? String(lead.value) : "");
  const [currency, setCurrency] = useState((lead.dealCurrency || "USD").toUpperCase());
  const [expectedCloseDate, setExpectedCloseDate] = useState(lead.expectedCloseDate ? new Date(lead.expectedCloseDate).toISOString().slice(0, 10) : "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStage(isDealStage(lead.status) ? lead.status : "proposal");
    setValue(lead.value != null ? String(lead.value) : "");
    setCurrency((lead.dealCurrency || "USD").toUpperCase());
    setExpectedCloseDate(lead.expectedCloseDate ? new Date(lead.expectedCloseDate).toISOString().slice(0, 10) : "");
  }, [lead.id, lead.status, lead.value, lead.dealCurrency, lead.expectedCloseDate]);

  const save = async () => {
    setSaving(true);
    const r = await fetch(`/api/admin/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: stage,
        value: value === "" ? null : parseInt(value),
        dealCurrency: currency,
        expectedCloseDate: expectedCloseDate || null,
      }),
    });
    setSaving(false);
    if (r.ok) { setEditing(false); onChange(); onToast({ ok: true, msg: "Deal updated" }); }
    else { const d = await r.json().catch(() => ({})); onToast({ ok: false, msg: d.error ?? "Failed" }); }
  };

  const hasDeal = isDealStage(lead.status) || lead.value != null || !!lead.expectedCloseDate;
  const inp = "w-full px-2.5 py-1.5 text-[12px] rounded-md bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";
  const startEditing = () => { if (!isDealStage(lead.status)) setStage("proposal"); setEditing(true); };

  return (
    <Panel title="Deal" right={<button onClick={() => editing ? setEditing(false) : startEditing()} className="text-stone-500 hover:text-emerald-400">{editing ? <X size={14} /> : <Plus size={14} />}</button>}>
      {editing ? (
        <div className="space-y-1.5">
          <select className={inp} value={stage} onChange={e => setStage(e.target.value)}>
            {PIPELINE_STAGES.filter(s => s.deal).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-1.5">
            <input className={inp} type="number" min="0" value={value} onChange={e => setValue(e.target.value)} placeholder="Value" />
            <select className={inp} value={currency} onChange={e => setCurrency(e.target.value)}>{["USD", "EUR", "GBP"].map(c => <option key={c}>{c}</option>)}</select>
          </div>
          <input className={inp} type="date" value={expectedCloseDate} onChange={e => setExpectedCloseDate(e.target.value)} />
          <button onClick={save} disabled={saving} className="w-full h-7 text-[11px] font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 text-white">{saving ? "Saving..." : "Save deal"}</button>
        </div>
      ) : hasDeal ? (
        <div className="space-y-2 text-[12px]">
          <div className="flex justify-between"><span className="text-stone-500">Stage</span><span className="text-stone-200">{stageLabel(lead.status)}</span></div>
          <div className="flex justify-between"><span className="text-stone-500">Value</span><span className="text-stone-200">{lead.value ? money(lead.value, lead.dealCurrency || "USD") : "-"}</span></div>
          <div className="flex justify-between"><span className="text-stone-500">Expected close</span><span className="text-stone-200">{lead.expectedCloseDate ? new Date(lead.expectedCloseDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "-"}</span></div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[12px] text-stone-600">No deal fields yet. This lead becomes a deal by moving into Proposal, Negotiation, or Won.</p>
          <button onClick={startEditing} className="w-full h-7 text-[11px] font-semibold rounded-md border border-stone-700 text-stone-300 hover:bg-stone-800">Start deal</button>
        </div>
      )}
    </Panel>
  );
}
// Tasks panel ────────────────────────────────────────────────────────────────
const PRIO_DOT: Record<string, string> = { high: "bg-rose-500", normal: "bg-stone-600", low: "bg-stone-700" };
const TASK_TYPE_LABEL: Record<string, string> = { todo: "To-do", call: "Call", email: "Email", follow_up: "Follow-up" };

function TasksPanel({ leadId, tasks, onChange, onToast }: any) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [type, setType] = useState("todo");
  const [prio, setPrio] = useState("normal");
  const open = tasks.filter((t: any) => !t.completedAt);
  const add = async () => {
    if (!title.trim()) return;
    const r = await fetch(`/api/admin/leads/${leadId}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, dueDate: due || null, type, priority: prio }) });
    if (r.ok) { setTitle(""); setDue(""); setType("todo"); setPrio("normal"); setAdding(false); onChange(); onToast({ ok: true, msg: "Task added" }); } else onToast({ ok: false, msg: "Failed" });
  };
  const inp = "w-full px-2.5 py-1.5 text-[12px] rounded-md bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";
  return (
    <Panel title={`Tasks${open.length ? ` (${open.length})` : ""}`} right={<button onClick={() => setAdding(a => !a)} className="text-stone-500 hover:text-emerald-400"><Plus size={14} /></button>}>
      {adding && (
        <div className="space-y-1.5 mb-3 pb-3 border-b border-stone-800">
          <input className={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="Follow up with…" />
          <div className="grid grid-cols-2 gap-1.5">
            <select className={inp} value={type} onChange={e => setType(e.target.value)}>
              <option value="todo">To-do</option><option value="call">Call</option><option value="email">Email</option><option value="follow_up">Follow-up</option>
            </select>
            <select className={inp} value={prio} onChange={e => setPrio(e.target.value)}>
              <option value="normal">Normal priority</option><option value="high">High priority</option><option value="low">Low priority</option>
            </select>
          </div>
          <input className={inp} type="datetime-local" value={due} onChange={e => setDue(e.target.value)} />
          <button onClick={add} className="w-full h-7 text-[11px] font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 text-white">Add task</button>
        </div>
      )}
      {open.length === 0 ? <p className="text-[12px] text-stone-600">No open tasks.</p> : (
        <div className="space-y-2">
          {open.map((t: any) => (
            <div key={t.id} className="flex items-start gap-2 text-[13px]">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${PRIO_DOT[t.priority] ?? PRIO_DOT.normal}`} title={`${t.priority ?? "normal"} priority`} />
              <CheckSquare size={13} className="text-stone-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-stone-300">{t.title}</p>
                <p className="text-[11px] text-stone-600">
                  {t.type && t.type !== "todo" ? `${TASK_TYPE_LABEL[t.type] ?? t.type}` : ""}
                  {t.type && t.type !== "todo" && t.dueDate ? " · " : ""}
                  {t.dueDate ? `due ${new Date(t.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ── Account & billing (Phase 0 Account 360: the full company lifecycle) ──────────
function centsMoney(cents: number, ccy = "usd") {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: (ccy || "usd").toUpperCase(), maximumFractionDigits: 0 }).format((cents || 0) / 100); }
  catch { return `${(ccy || "USD").toUpperCase()} ${(cents / 100).toFixed(0)}`; }
}
function AccountPanel({ lead, account }: { lead: any; account: any }) {
  const won = lead.status === "converted";
  const invoiced = account?.invoiced;
  const paid = account?.invoices?.some((i: any) => i.status === "paid") || account?.subscription?.status === "active";
  const activated = account?.activated;
  // lifecycle steps with done-state
  const steps = [
    { k: "Lead", done: true },
    { k: "Deal", done: !!account?.hasDeal || won },
    { k: "Invoiced", done: !!invoiced },
    { k: "Paid", done: !!paid },
    { k: "Active", done: !!activated },
  ];
  return (
    <Panel title="Customer & billing">
      <div className="flex items-center gap-1 mb-3">
        {steps.map((s, i) => (
          <div key={s.k} className="flex items-center gap-1 flex-1 min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.done ? "bg-emerald-400" : "bg-stone-700"}`} />
            <span className={`text-[10px] truncate ${s.done ? "text-stone-300" : "text-stone-600"}`}>{s.k}</span>
            {i < steps.length - 1 && <span className={`flex-1 h-px ${s.done ? "bg-emerald-500/30" : "bg-stone-800"}`} />}
          </div>
        ))}
      </div>
      {!account?.hasDeal ? (
        <p className="text-[12px] text-stone-600">No deal yet — convert this lead to start the billing flow.</p>
      ) : (
        <div className="space-y-2.5">
          {account?.organisation && (
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-stone-400">Customer</span>
              <span className="flex items-center gap-2 min-w-0"><span className="text-stone-200 truncate">{account.organisation.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${activated ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>{activated ? "Active" : "Pending"}</span></span>
            </div>
          )}
          {account?.subscription && (
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-stone-400">Subscription</span>
              <span className="text-stone-300 truncate">{account.subscription.planName || "Plan"}{account.subscription.planAmount != null ? ` · ${centsMoney(account.subscription.planAmount, account.subscription.planCurrency)}/${account.subscription.planInterval === "year" ? "yr" : "mo"}` : ""} <span className="text-stone-500">({account.subscription.status})</span></span>
            </div>
          )}
          {account?.invoices?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">Invoices</p>
              {account.invoices.map((inv: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-[12px] py-0.5">
                  <span className="text-stone-300">{inv.total != null ? money(inv.total, inv.currency) : "Invoice"}</span>
                  <span className="flex items-center gap-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${inv.status === "paid" ? "bg-emerald-500/15 text-emerald-300" : "bg-sky-500/15 text-sky-300"}`}>{inv.status}</span>
                    {inv.url && <a href={inv.url} target="_blank" rel="noopener noreferrer" className="text-stone-500 hover:text-emerald-400">view</a>}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ── Contacts panel (relational: people belonging to this lead) ───────────────────
function ContactsPanel({ leadId, contacts, onChange, onToast }: any) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [title, setTitle] = useState("");
  const add = async () => {
    if (!name.trim()) return;
    const r = await fetch(`/api/admin/leads/${leadId}/contacts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, email, title }) });
    if (r.ok) { setName(""); setEmail(""); setTitle(""); setAdding(false); onChange(); onToast({ ok: true, msg: "Contact added" }); }
    else { const d = await r.json().catch(() => ({})); onToast({ ok: false, msg: d.error ?? "Failed" }); }
  };
  const del = async (cid: string) => {
    if (cid === "primary") return;
    await fetch(`/api/admin/leads/${leadId}/contacts/${cid}`, { method: "DELETE" });
    onChange(); onToast({ ok: true, msg: "Contact removed" });
  };
  const inp = "w-full px-2.5 py-1.5 text-[12px] rounded-md bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";
  return (
    <Panel title="Contacts" right={<button onClick={() => setAdding(a => !a)} className="text-stone-500 hover:text-emerald-400"><Plus size={14} /></button>}>
      {adding && (
        <div className="space-y-1.5 mb-3 pb-3 border-b border-stone-800">
          <input className={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
          <input className={inp} value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
          <input className={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="Title / role" />
          <button onClick={add} className="w-full h-7 text-[11px] font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 text-white">Add contact</button>
        </div>
      )}
      {contacts.length === 0 ? <p className="text-[12px] text-stone-600">No contacts.</p> : (
        <div className="space-y-2">
          {contacts.map((c: any) => (
            <div key={c.id} className="flex items-center gap-2.5 group/c">
              <span className="w-8 h-8 rounded-full bg-stone-800 flex items-center justify-center text-[10px] text-stone-300 shrink-0">{(c.name || "?").slice(0, 2).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5"><p className="text-[13px] text-stone-200 truncate">{c.name}</p>{c.isPrimary && <span className="text-[9px] text-emerald-400 bg-emerald-500/10 rounded px-1 py-0.5">Primary</span>}</div>
                <p className="text-[11px] text-stone-500 truncate">{c.title ? `${c.title} · ` : ""}{c.email || c.phone || "—"}</p>
              </div>
              {c.id !== "primary" && <button onClick={() => del(c.id)} className="opacity-0 group-hover/c:opacity-100 text-stone-600 hover:text-rose-400"><Trash2 size={12} /></button>}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ── Sequence panel ──────────────────────────────────────────────────────────────
function SequencePanel({ leadId, active, sequences, onChange, onToast }: any) {
  const apply = async (sequenceId: string) => {
    if (!sequenceId) return;
    const r = await fetch(`/api/admin/leads/${leadId}/enrollments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sequenceId }) });
    if (r.ok) { onChange(); onToast({ ok: true, msg: "Enrolled" }); } else { const d = await r.json().catch(() => ({})); onToast({ ok: false, msg: d.error ?? "Failed" }); }
  };
  const stop = async () => {
    if (!active) return;
    const r = await fetch(`/api/admin/leads/${leadId}/enrollments/${active.id}`, { method: "DELETE" });
    if (r.ok) { onChange(); onToast({ ok: true, msg: "Sequence stopped" }); }
  };
  return (
    <Panel title="Sequence">
      {active ? (
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-violet-300"><Zap size={12} /> {active.sequenceName}</span>
          <button onClick={stop} className="text-[11px] text-stone-500 hover:text-rose-400">Stop</button>
        </div>
      ) : sequences.length === 0 ? <p className="text-[12px] text-stone-600">No active sequences.</p> : (
        <select defaultValue="" onChange={e => { apply(e.target.value); e.target.value = ""; }} className="w-full px-2.5 py-1.5 text-[12px] rounded-md bg-stone-800 border border-stone-700 text-stone-300 focus:outline-none focus:border-emerald-500">
          <option value="">Apply sequence…</option>
          {sequences.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
    </Panel>
  );
}
