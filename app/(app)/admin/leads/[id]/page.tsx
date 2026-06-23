"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { OPP_STAGES } from "@/lib/opportunities";
import {
  ArrowLeft, Mail, StickyNote, CheckSquare, Trophy, Phone, Zap, Loader,
  Building2, Globe, Send, Plus, Clock, MessageSquare, ChevronDown, Filter,
} from "lucide-react";

const STATUS = ["new", "contacted", "qualified", "converted", "rejected", "archived"];
const STATUS_LABEL: Record<string, string> = { new: "New", contacted: "Contacted", qualified: "Qualified", converted: "Won", rejected: "Lost", archived: "Archived" };

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
  const [opps, setOpps] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [sequences, setSequences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"note" | "email">("note");
  const [filter, setFilter] = useState<"all" | "email" | "note" | "call">("all");
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetch(`/api/admin/leads/${id}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/admin/leads/${id}/notes`).then(r => r.ok ? r.json() : []),
      fetch(`/api/admin/leads/${id}/tasks`).then(r => r.ok ? r.json() : []),
      fetch(`/api/admin/opportunities?leadId=${id}`).then(r => r.ok ? r.json() : { opportunities: [] }),
      fetch(`/api/admin/leads/${id}/enrollments`).then(r => r.ok ? r.json() : []),
      fetch(`/api/admin/sequences`).then(r => r.ok ? r.json() : []),
    ]).then(([l, n, t, o, e, s]) => {
      setLead(l); setNotes(Array.isArray(n) ? n : []); setTasks(Array.isArray(t) ? t : []);
      setOpps(o.opportunities ?? []); setEnrollments(Array.isArray(e) ? e : []);
      setSequences((Array.isArray(s) ? s : []).filter((x: any) => x.isActive));
    }).finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); } }, [toast]);

  const activities = useMemo(() => {
    const items = notes.map(parseActivity).map(a => ({ ...a, at: a.raw.createdAt, author: a.raw.authorName }));
    const sorted = items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return filter === "all" ? sorted : sorted.filter(a => a.kind === filter);
  }, [notes, filter]);

  const activeEnrollment = enrollments.find(e => e.status === "active");

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

      <div className="grid lg:grid-cols-[320px_1fr] gap-5">
        {/* ── Left: about + opportunities + tasks + sequence ── */}
        <div className="space-y-4">
          <Panel title="About">
            <Field label="Email" value={lead.email} />
            <Field label="Phone" value={lead.phone || "—"} />
            <Field label="Company" value={lead.companyName || "—"} />
            <Field label="Country" value={lead.country || "—"} />
            <Field label="Service" value={lead.interestedService || "—"} />
            <Field label="Source" value={lead.source === "manual" ? "Manual" : "Website"} />
            <Field label="Received" value={new Date(lead.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} />
          </Panel>

          <OpportunitiesPanel leadId={id} opps={opps} onChange={load} onToast={setToast} />

          <TasksPanel leadId={id} tasks={tasks} onChange={load} onToast={setToast} />

          <SequencePanel leadId={id} active={activeEnrollment} sequences={sequences} onChange={load} onToast={setToast} />
        </div>

        {/* ── Right: composer + activity timeline ── */}
        <div className="space-y-4 min-w-0">
          <Composer leadId={id} lead={lead} tab={tab} setTab={setTab} onSent={load} onToast={setToast} />

          <Panel title="Activity" right={
            <div className="flex items-center gap-1">
              <Filter size={11} className="text-stone-600" />
              {(["all", "email", "note", "call"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} className={`text-[11px] px-1.5 py-0.5 rounded ${filter === f ? "bg-stone-700 text-white" : "text-stone-500 hover:text-stone-300"}`}>{f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}</button>
              ))}
            </div>
          }>
            {activities.length === 0 ? (
              <p className="text-[13px] text-stone-600 py-6 text-center">No activity yet. Log a note or send an email above.</p>
            ) : (
              <div className="space-y-3">
                {activities.map((a, i) => <ActivityItem key={i} a={a} />)}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {toast && <div className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-xl ${toast.ok ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{toast.msg}</div>}
    </div>
  );
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

// ── Composer (Note / Email) ────────────────────────────────────────────────────
function Composer({ leadId, lead, tab, setTab, onSent, onToast }: any) {
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const saveNote = async () => {
    if (!note.trim()) return; setBusy(true);
    const r = await fetch(`/api/admin/leads/${leadId}/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: note.trim() }) });
    setBusy(false);
    if (r.ok) { setNote(""); onSent(); onToast({ ok: true, msg: "Note added" }); } else onToast({ ok: false, msg: "Failed" });
  };
  const sendEmail = async () => {
    if (!subject.trim() || !body.trim()) { onToast({ ok: false, msg: "Subject and body required" }); return; }
    setBusy(true);
    const r = await fetch(`/api/admin/leads/${leadId}/email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject, body }) });
    const d = await r.json().catch(() => ({})); setBusy(false);
    if (r.ok) { setSubject(""); setBody(""); onSent(); onToast({ ok: true, msg: "Email sent" }); }
    else onToast({ ok: false, msg: d.error ?? "Send failed" });
  };

  const inp = "w-full px-3 py-2 text-[13px] rounded-md bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";
  return (
    <div className="rounded-xl border border-stone-800 bg-stone-900/40">
      <div className="flex items-center gap-1 px-3 pt-3">
        {[{ k: "note", label: "Note", icon: StickyNote }, { k: "email", label: "Email", icon: Mail }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-t-lg ${tab === t.k ? "bg-stone-800 text-white" : "text-stone-500 hover:text-stone-300"}`}><t.icon size={13} /> {t.label}</button>
        ))}
      </div>
      <div className="p-3 border-t border-stone-800">
        {tab === "note" ? (
          <div className="space-y-2">
            <textarea className={`${inp} resize-none`} rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Log a note about this lead…" />
            <div className="flex justify-end"><button onClick={saveNote} disabled={busy || !note.trim()} className="h-8 px-3.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 text-white flex items-center gap-1.5">{busy ? <Loader size={12} className="animate-spin" /> : <Plus size={12} />} Add note</button></div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-stone-500"><span>To: <span className="text-stone-300">{lead.email}</span></span><span className="text-emerald-400/80">sends from your connected mailbox</span></div>
            <input className={inp} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" />
            <textarea className={`${inp} resize-none`} rows={5} value={body} onChange={e => setBody(e.target.value)} placeholder={`Hi ${lead.fullName?.split(" ")[0] ?? ""},`} />
            <div className="flex justify-end"><button onClick={sendEmail} disabled={busy} className="h-8 px-3.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 text-white flex items-center gap-1.5">{busy ? <Loader size={12} className="animate-spin" /> : <Send size={12} />} Send</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Opportunities panel ────────────────────────────────────────────────────────
function OpportunitiesPanel({ leadId, opps, onChange, onToast }: any) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState(""); const [value, setValue] = useState(""); const [stage, setStage] = useState("discovery");
  const add = async () => {
    if (!title.trim()) return;
    const r = await fetch("/api/admin/opportunities", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, leadId, value: value ? parseInt(value) : 0, stage }) });
    if (r.ok) { setTitle(""); setValue(""); setAdding(false); onChange(); onToast({ ok: true, msg: "Deal added" }); }
    else { const d = await r.json().catch(() => ({})); onToast({ ok: false, msg: d.error ?? "Failed" }); }
  };
  const inp = "w-full px-2.5 py-1.5 text-[12px] rounded-md bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";
  return (
    <Panel title="Opportunities" right={<button onClick={() => setAdding(a => !a)} className="text-stone-500 hover:text-emerald-400"><Plus size={14} /></button>}>
      {adding && (
        <div className="space-y-1.5 mb-3 pb-3 border-b border-stone-800">
          <input className={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="Deal title" />
          <div className="grid grid-cols-2 gap-1.5">
            <input className={inp} type="number" value={value} onChange={e => setValue(e.target.value)} placeholder="Value" />
            <select className={inp} value={stage} onChange={e => setStage(e.target.value)}>{OPP_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          </div>
          <button onClick={add} className="w-full h-7 text-[11px] font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 text-white">Add deal</button>
        </div>
      )}
      {opps.length === 0 ? <p className="text-[12px] text-stone-600">No deals yet.</p> : (
        <div className="space-y-2">
          {opps.map((o: any) => {
            const st = OPP_STAGES.find(s => s.key === o.stage);
            return (
              <Link key={o.id} href="/admin/opportunities" className="block rounded-lg border border-stone-800 hover:border-stone-600 p-2.5">
                <div className="flex items-center justify-between gap-2"><span className="text-[12.5px] text-stone-200 truncate">{o.title}</span><span className="text-[12px] font-semibold text-stone-200">{money(o.value, o.currency)}</span></div>
                <div className="flex items-center gap-2 mt-1"><span className="text-[10px] text-stone-500">{st?.label}</span><span className="text-[10px] text-stone-600">· {o.confidence}%</span></div>
              </Link>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ── Tasks panel ────────────────────────────────────────────────────────────────
function TasksPanel({ leadId, tasks, onChange, onToast }: any) {
  const [adding, setAdding] = useState(false); const [title, setTitle] = useState(""); const [due, setDue] = useState("");
  const open = tasks.filter((t: any) => !t.completedAt);
  const add = async () => {
    if (!title.trim()) return;
    const r = await fetch(`/api/admin/leads/${leadId}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, dueDate: due || null }) });
    if (r.ok) { setTitle(""); setDue(""); setAdding(false); onChange(); onToast({ ok: true, msg: "Task added" }); } else onToast({ ok: false, msg: "Failed" });
  };
  const inp = "w-full px-2.5 py-1.5 text-[12px] rounded-md bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";
  return (
    <Panel title={`Tasks${open.length ? ` (${open.length})` : ""}`} right={<button onClick={() => setAdding(a => !a)} className="text-stone-500 hover:text-emerald-400"><Plus size={14} /></button>}>
      {adding && (
        <div className="space-y-1.5 mb-3 pb-3 border-b border-stone-800">
          <input className={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="Follow up with…" />
          <input className={inp} type="date" value={due} onChange={e => setDue(e.target.value)} />
          <button onClick={add} className="w-full h-7 text-[11px] font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 text-white">Add task</button>
        </div>
      )}
      {open.length === 0 ? <p className="text-[12px] text-stone-600">No open tasks.</p> : (
        <div className="space-y-2">
          {open.map((t: any) => (
            <div key={t.id} className="flex items-start gap-2 text-[13px]">
              <CheckSquare size={13} className="text-stone-600 mt-0.5 shrink-0" />
              <div className="min-w-0"><p className="text-stone-300">{t.title}</p>{t.dueDate && <p className="text-[11px] text-stone-600">due {new Date(t.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>}</div>
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
