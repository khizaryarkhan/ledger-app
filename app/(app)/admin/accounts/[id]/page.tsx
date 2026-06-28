"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, Loader, Building2, Mail, StickyNote, CheckSquare, Send, Trophy,
  FileText, CheckCircle2, User, ArrowRight, ExternalLink, CreditCard, Phone, Clock, Sparkles,
  Plus, X, Trash2, MessageCircle, CalendarCheck,
} from "lucide-react";
import { fmt } from "@/lib/format";

const QUOTE_STATUS: Record<string, string> = {
  draft: "bg-stone-700 text-stone-300", sent: "bg-sky-500/15 text-sky-300",
  accepted: "bg-emerald-500/15 text-emerald-300", declined: "bg-rose-500/15 text-rose-300", expired: "bg-stone-700 text-stone-500",
};

const STAGE: Record<string, { label: string; cls: string }> = {
  lead: { label: "Lead", cls: "bg-sky-500/15 text-sky-300" },
  prospect: { label: "Prospect", cls: "bg-blue-500/15 text-blue-300" },
  qualified: { label: "Qualified", cls: "bg-violet-500/15 text-violet-300" },
  customer: { label: "Customer", cls: "bg-emerald-500/15 text-emerald-300" },
  churned: { label: "Churned", cls: "bg-rose-500/15 text-rose-300" },
  archived: { label: "Archived", cls: "bg-stone-700 text-stone-400" },
};

// Activity type → icon + accent.
const ACT: Record<string, { icon: any; cls: string }> = {
  email_sent: { icon: Mail, cls: "text-sky-400" },
  email_received: { icon: Mail, cls: "text-emerald-400" },
  call_logged: { icon: Phone, cls: "text-violet-400" },
  note_added: { icon: StickyNote, cls: "text-amber-400" },
  task_created: { icon: CheckSquare, cls: "text-stone-400" },
  task_completed: { icon: CheckSquare, cls: "text-emerald-400" },
  status_changed: { icon: ArrowRight, cls: "text-stone-400" },
  sequence_enrolled: { icon: Send, cls: "text-blue-400" },
  sequence_sent: { icon: Send, cls: "text-sky-400" },
  sequence_stopped: { icon: Send, cls: "text-rose-400" },
  deal_created: { icon: Trophy, cls: "text-violet-400" },
  deal_moved: { icon: Trophy, cls: "text-stone-400" },
  deal_won: { icon: Trophy, cls: "text-emerald-400" },
  deal_lost: { icon: Trophy, cls: "text-rose-400" },
  invoice_issued: { icon: FileText, cls: "text-sky-400" },
  payment_received: { icon: CheckCircle2, cls: "text-emerald-400" },
  customer_activated: { icon: CheckCircle2, cls: "text-emerald-400" },
  owner_assigned: { icon: User, cls: "text-stone-400" },
  account_created: { icon: Building2, cls: "text-stone-400" },
  whatsapp_sent: { icon: MessageCircle, cls: "text-emerald-400" },
  meeting_booked: { icon: CalendarCheck, cls: "text-sky-400" },
};

const when = (t: string | number | null) => {
  if (!t) return "";
  const d = new Date(t);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) + " · " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};

function Panel({ title, count, action, children }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-stone-800 bg-stone-900/40">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800">
        <span className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">{title}{count != null && <span className="ml-1.5 text-stone-600">{count}</span>}</span>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function QuotesPanel({ accountId, orgId, quotes, onChange }: { accountId: string; orgId: string | null; quotes: any[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<{ description: string; qty: string; unitPrice: string }[]>([{ description: "", qty: "1", unitPrice: "" }]);
  const [currency, setCurrency] = useState("USD");
  const [saving, setSaving] = useState(false);
  const m = (minor: number, c: string) => fmt.money((minor ?? 0) / 100, (c || "USD").toUpperCase());
  const total = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.unitPrice) || 0), 0);

  const setLine = (i: number, k: string, v: string) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const addLine = () => setLines(ls => [...ls, { description: "", qty: "1", unitPrice: "" }]);
  const rmLine = (i: number) => setLines(ls => ls.filter((_, j) => j !== i));

  const create = async () => {
    const lineItems = lines
      .map(l => ({ description: l.description.trim(), qty: parseFloat(l.qty) || 0, unitPrice: Math.round((parseFloat(l.unitPrice) || 0) * 100) }))
      .filter(l => l.description && l.qty > 0 && l.unitPrice > 0);
    if (!lineItems.length) return;
    setSaving(true);
    try {
      const r = await fetch("/api/admin/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, orgId, currency, lineItems }) });
      if (r.ok) { setOpen(false); setLines([{ description: "", qty: "1", unitPrice: "" }]); onChange(); }
    } finally { setSaving(false); }
  };
  const setStatus = async (id: string, status: string) => {
    await fetch(`/api/admin/quotes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }).catch(() => {});
    onChange();
  };
  const inp = "w-full px-2.5 py-1.5 text-[12px] rounded-md bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";

  return (
    <div className="rounded-xl border border-stone-800 bg-stone-900/40">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800">
        <span className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">Quotes<span className="ml-1.5 text-stone-600">{quotes.length}</span></span>
        <button onClick={() => setOpen(o => !o)} className="text-stone-500 hover:text-emerald-400"><Plus size={14} /></button>
      </div>
      <div className="p-3">
        {open && (
          <div className="space-y-1.5 mb-3 pb-3 border-b border-stone-800">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input className={inp} value={l.description} onChange={e => setLine(i, "description", e.target.value)} placeholder="Item / service" />
                <input className={`${inp} w-12 text-center`} value={l.qty} onChange={e => setLine(i, "qty", e.target.value)} placeholder="1" />
                <input className={`${inp} w-20`} value={l.unitPrice} onChange={e => setLine(i, "unitPrice", e.target.value)} placeholder="0.00" inputMode="decimal" />
                {lines.length > 1 && <button onClick={() => rmLine(i)} className="text-stone-600 hover:text-rose-400 shrink-0"><Trash2 size={12} /></button>}
              </div>
            ))}
            <div className="flex items-center justify-between pt-1">
              <button onClick={addLine} className="text-[11px] text-stone-400 hover:text-stone-200 flex items-center gap-1"><Plus size={11} /> Line</button>
              <span className="text-[12px] text-stone-300">Total {fmt.money(total, currency)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <select className={`${inp} w-20`} value={currency} onChange={e => setCurrency(e.target.value)}>
                {["USD", "EUR", "GBP"].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={create} disabled={saving} className="flex-1 h-7 text-[11px] font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60">{saving ? "Saving…" : "Create quote"}</button>
            </div>
          </div>
        )}
        {quotes.length === 0 ? <p className="text-xs text-stone-600">No quotes.</p> : (
          <div className="space-y-2">
            {quotes.map((q: any) => (
              <div key={q.id} className="flex items-center gap-2 text-[13px]">
                <FileText size={13} className="text-stone-500 shrink-0" />
                <span className="font-mono text-[11px] text-stone-500">{q.ref}</span>
                <span className="text-stone-200 tabular-nums">{m(q.total, q.currency)}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${QUOTE_STATUS[q.status] ?? QUOTE_STATUS.draft}`}>{q.status}</span>
                <div className="ml-auto flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  {q.status === "draft" && <button onClick={() => setStatus(q.id, "sent")} className="text-[10px] text-sky-400 hover:text-sky-300">Send</button>}
                  {q.status === "sent" && <button onClick={() => setStatus(q.id, "accepted")} className="text-[10px] text-emerald-400 hover:text-emerald-300">Accept</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Account360Page() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [billing, setBilling] = useState<any>(null); // Stripe invoices/payments (when the account has an org)

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/accounts/${id}`).then(r => r.ok ? r.json() : null).then(d => {
      setData(d);
      // Pull the full billing history into the cockpit so everything's in one place.
      const orgId = d?.account?.organisationId;
      if (orgId) {
        fetch(`/api/admin/billing/org/${orgId}`).then(r => r.ok ? r.json() : null).then(setBilling).catch(() => {});
      } else setBilling(null);
    }).finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { if (id) load(); }, [id, load]);

  const assignOwner = async (ownerAdminId: string) => {
    setData((d: any) => ({ ...d, account: { ...d.account, ownerAdminId } }));
    await fetch(`/api/admin/accounts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerAdminId: ownerAdminId || null }) }).catch(() => {});
  };

  // AI next-best-action (on demand).
  const [nba, setNba] = useState<any>(null);
  const [nbaLoading, setNbaLoading] = useState(false);
  const suggest = async () => {
    setNbaLoading(true); setNba(null);
    try {
      const r = await fetch(`/api/admin/accounts/${id}/next-action`, { method: "POST" });
      const d = await r.json();
      setNba(r.ok ? d : { error: d.error || "Failed" });
    } catch { setNba({ error: "Failed" }); } finally { setNbaLoading(false); }
  };

  // Manual touches — call / whatsapp / meeting.
  const [logKind, setLogKind] = useState<"call" | "whatsapp" | null>(null);
  const [logOutcome, setLogOutcome] = useState("");
  const [logNote, setLogNote] = useState("");
  const [logFollowup, setLogFollowup] = useState("");
  const [logSaving, setLogSaving] = useState(false);

  const logTouch = async (type: string, extra: any = {}) => {
    await fetch(`/api/admin/accounts/${id}/log-touch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, ...extra }) }).catch(() => {});
    load();
  };
  const submitLog = async () => {
    if (!logKind) return;
    setLogSaving(true);
    try {
      await logTouch(logKind, { outcome: logOutcome || undefined, note: logNote || undefined, followupTitle: logFollowup || undefined });
      setLogKind(null); setLogOutcome(""); setLogNote(""); setLogFollowup("");
    } finally { setLogSaving(false); }
  };

  // Inline compose — Note / Task / Email (account-scoped; works for any company).
  const [compose, setCompose] = useState<null | "note" | "task" | "email">(null);
  const [noteText, setNoteText] = useState("");
  const [taskForm, setTaskForm] = useState({ title: "", type: "todo", priority: "normal", due: "" });
  const [emailForm, setEmailForm] = useState({ subject: "", body: "" });
  const [acting, setActing] = useState(false);
  const closeCompose = () => { setCompose(null); setNoteText(""); setTaskForm({ title: "", type: "todo", priority: "normal", due: "" }); setEmailForm({ subject: "", body: "" }); };

  const postNote = async () => {
    if (!noteText.trim()) return; setActing(true);
    try { await fetch(`/api/admin/accounts/${id}/note`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: noteText }) }); closeCompose(); load(); }
    finally { setActing(false); }
  };
  const postTask = async () => {
    if (!taskForm.title.trim()) return; setActing(true);
    try { await fetch(`/api/admin/accounts/${id}/task`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: taskForm.title, type: taskForm.type, priority: taskForm.priority, dueDate: taskForm.due || null }) }); closeCompose(); load(); }
    finally { setActing(false); }
  };
  const sendEmail = async () => {
    const leadId = data?.lead?.id; if (!leadId || !emailForm.subject.trim() || !emailForm.body.trim()) return; setActing(true);
    try {
      const r = await fetch(`/api/admin/leads/${leadId}/email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: emailForm.subject, body: emailForm.body }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Send failed"); return; }
      closeCompose(); load();
    } finally { setActing(false); }
  };

  if (loading) return <div className="max-w-[1300px] mx-auto"><div className="h-64 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" /></div>;
  if (!data?.account) return <div className="max-w-[1300px] mx-auto py-16 text-center text-stone-500">Account not found.</div>;

  const a = data.account;
  const s = STAGE[a.lifecycleStage] ?? { label: a.lifecycleStage, cls: "bg-stone-700 text-stone-400" };
  const sub = data.subscription;
  const money = (v: number, c?: string) => fmt.money(v ?? 0, (c ?? "USD").toUpperCase());

  return (
    <div className="max-w-[1300px] mx-auto">
      <Link href="/admin/accounts" className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-300 mb-3"><ChevronLeft size={14} /> Accounts</Link>

      {/* Header */}
      <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-5 mb-4">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-stone-800 flex items-center justify-center text-stone-300 font-bold">{(a.name || "?").slice(0, 2).toUpperCase()}</div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white">{a.name}</h1>
                <span className={`text-[11px] px-2 py-0.5 rounded ${s.cls}`}>{s.label}</span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-[12px] text-stone-500">
                <span className="font-mono">{a.ref}</span>
                {a.billingEmail && <span>{a.billingEmail}</span>}
                {a.country && <span>{a.country}</span>}
                {a.orgStatus && <span className={a.orgStatus === "Active" ? "text-emerald-400" : "text-amber-400"}>{a.orgStatus}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <User size={13} className="text-stone-500" />
              <select value={a.ownerAdminId ?? ""} onChange={e => assignOwner(e.target.value)}
                className="h-8 px-2 text-xs rounded-lg bg-stone-900 border border-stone-700 text-stone-300">
                <option value="">Unassigned</option>
                {data.admins?.map((ad: any) => <option key={ad.id} value={ad.id}>{ad.name || ad.email}</option>)}
              </select>
            </div>
            <button onClick={() => setCompose("note")}
              className="flex items-center gap-1.5 h-8 px-3 text-xs rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800"><StickyNote size={13} /> Note</button>
            <button onClick={() => { if (data.lead?.id) setCompose("email"); else alert("No lead/contact on this account to email from."); }}
              className="flex items-center gap-1.5 h-8 px-3 text-xs rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800"><Mail size={13} /> Email</button>
            <button onClick={() => setCompose("task")}
              className="flex items-center gap-1.5 h-8 px-3 text-xs rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800"><CheckSquare size={13} /> Task</button>
            <button onClick={() => { const p = data.lead?.phone; if (p) window.open(`tel:${p}`); setLogKind("call"); }}
              className="flex items-center gap-1.5 h-8 px-3 text-xs rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800"><Phone size={13} /> Call</button>
            <button onClick={() => { const p = (data.lead?.phone || "").replace(/\D/g, ""); if (p) window.open(`https://wa.me/${p}?text=${encodeURIComponent(`Hi ${data.lead?.fullName ?? ""}`.trim())}`, "_blank"); setLogKind("whatsapp"); }}
              className="flex items-center gap-1.5 h-8 px-3 text-xs rounded-lg border border-stone-700 text-emerald-300 hover:bg-stone-800"><MessageCircle size={13} /> WhatsApp</button>
            <button onClick={() => { if (data.viewerSchedulingUrl) { window.open(data.viewerSchedulingUrl, "_blank"); logTouch("meeting", { outcome: "booking link sent" }); } else alert("Add your Calendly link first: Settings → Email Integration → Scheduling link."); }}
              className="flex items-center gap-1.5 h-8 px-3 text-xs rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800"><CalendarCheck size={13} /> Book</button>
            {a.organisationId && <Link href={`/admin/customers/${a.organisationId}`} className="flex items-center gap-1.5 h-8 px-3 text-xs rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800"><CreditCard size={13} /> Billing</Link>}
            {a.leadId && <Link href={`/admin/leads/${a.leadId}`} className="flex items-center gap-1.5 h-8 px-3 text-xs rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800"><Mail size={13} /> Lead cockpit</Link>}
          </div>
        </div>
      </div>

      {/* AI next-best-action */}
      <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-4 mb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={15} className="text-violet-400 shrink-0" />
            {nbaLoading ? (
              <span className="text-sm text-stone-400">Thinking…</span>
            ) : nba?.error ? (
              <span className="text-sm text-rose-400">{nba.error}</span>
            ) : nba?.action ? (
              <div className="min-w-0">
                <p className="text-sm text-stone-100">{nba.action}
                  {nba.urgency && <span className={`ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded ${nba.urgency === "high" ? "bg-rose-500/15 text-rose-300" : nba.urgency === "low" ? "bg-stone-700 text-stone-400" : "bg-amber-500/15 text-amber-300"}`}>{nba.urgency}</span>}
                </p>
                {nba.reason && <p className="text-[12px] text-stone-500 mt-0.5">{nba.reason}</p>}
              </div>
            ) : (
              <span className="text-sm text-stone-400">Next best action</span>
            )}
          </div>
          <button onClick={suggest} disabled={nbaLoading}
            className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg bg-violet-600/80 hover:bg-violet-600 text-white shrink-0 disabled:opacity-60">
            {nbaLoading ? <Loader size={13} className="animate-spin" /> : <Sparkles size={13} />} {nba?.action ? "Refresh" : "Suggest"}
          </button>
        </div>
      </div>

      {/* Compose modal — Note / Task / Email */}
      {compose && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-stone-900 rounded-xl w-full max-w-md ring-1 ring-stone-800">
            <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
              <h2 className="font-semibold text-white capitalize">{compose === "email" ? "Send email" : compose === "task" ? "New task" : "Add note"}</h2>
              <button onClick={closeCompose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3">
              {compose === "note" && (
                <textarea autoFocus value={noteText} onChange={e => setNoteText(e.target.value)} rows={4} placeholder="Log a note about this company…"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500" />
              )}
              {compose === "task" && (<>
                <input autoFocus value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} placeholder="Task title"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500" />
                <div className="grid grid-cols-3 gap-2">
                  <select value={taskForm.type} onChange={e => setTaskForm(f => ({ ...f, type: e.target.value }))} className="px-2 py-2 text-sm rounded-lg bg-stone-800 border border-stone-700 text-stone-200"><option value="todo">To-do</option><option value="call">Call</option><option value="email">Email</option><option value="follow_up">Follow-up</option></select>
                  <select value={taskForm.priority} onChange={e => setTaskForm(f => ({ ...f, priority: e.target.value }))} className="px-2 py-2 text-sm rounded-lg bg-stone-800 border border-stone-700 text-stone-200"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select>
                  <input type="datetime-local" value={taskForm.due} onChange={e => setTaskForm(f => ({ ...f, due: e.target.value }))} className="px-2 py-2 text-xs rounded-lg bg-stone-800 border border-stone-700 text-stone-200" />
                </div>
              </>)}
              {compose === "email" && (<>
                <p className="text-[11px] text-stone-500">To <span className="text-stone-300">{data.lead?.email}</span> — sent from your connected mailbox.</p>
                <input autoFocus value={emailForm.subject} onChange={e => setEmailForm(f => ({ ...f, subject: e.target.value }))} placeholder="Subject"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500" />
                <textarea value={emailForm.body} onChange={e => setEmailForm(f => ({ ...f, body: e.target.value }))} rows={6} placeholder="Write your message…"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500" />
              </>)}
            </div>
            <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
              <button onClick={closeCompose} className="h-9 px-4 text-sm rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800">Cancel</button>
              <button onClick={compose === "note" ? postNote : compose === "task" ? postTask : sendEmail} disabled={acting}
                className="h-9 px-4 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60 flex items-center gap-1.5">
                {acting ? <Loader size={14} className="animate-spin" /> : null}{compose === "email" ? "Send" : compose === "task" ? "Add task" : "Save note"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log-touch modal */}
      {logKind && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-stone-900 rounded-xl w-full max-w-sm ring-1 ring-stone-800">
            <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
              <h2 className="font-semibold text-white flex items-center gap-2">{logKind === "call" ? <><Phone size={15} /> Log call</> : <><MessageCircle size={15} className="text-emerald-400" /> Log WhatsApp</>}</h2>
              <button onClick={() => setLogKind(null)} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs text-stone-400 block mb-1.5">Outcome</label>
                <select value={logOutcome} onChange={e => setLogOutcome(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg bg-stone-800 border border-stone-700 text-stone-200">
                  <option value="">— select —</option>
                  {(logKind === "call" ? ["Connected", "Left voicemail", "No answer", "Wrong number", "Not interested", "Interested", "Demo booked"] : ["Replied", "Sent", "No response"]).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div><label className="text-xs text-stone-400 block mb-1.5">Note</label><textarea value={logNote} onChange={e => setLogNote(e.target.value)} rows={2} className="w-full px-3 py-2 text-sm rounded-lg bg-stone-800 border border-stone-700 text-stone-200" placeholder="What happened…" /></div>
              <div><label className="text-xs text-stone-400 block mb-1.5">Follow-up task (optional)</label><input value={logFollowup} onChange={e => setLogFollowup(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg bg-stone-800 border border-stone-700 text-stone-200" placeholder="e.g. Call back Friday" /></div>
            </div>
            <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
              <button onClick={() => setLogKind(null)} className="h-9 px-4 text-sm rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800">Cancel</button>
              <button onClick={submitLog} disabled={logSaving} className="h-9 px-4 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60">{logSaving ? "Saving…" : "Log it"}</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Left: relations */}
        <div className="space-y-4">
          <Panel title="Contacts" count={data.contacts?.length ?? 0}>
            {data.contacts?.length ? data.contacts.map((c: any) => (
              <div key={c.id} className="flex items-center gap-2 py-1.5">
                <div className="w-7 h-7 rounded-full bg-stone-800 flex items-center justify-center text-[10px] text-stone-300">{(c.name || "?").slice(0, 2).toUpperCase()}</div>
                <div className="min-w-0">
                  <div className="text-sm text-stone-200 truncate">{c.name}{c.isPrimary && <span className="ml-1.5 text-[9px] uppercase text-emerald-400">primary</span>}</div>
                  <div className="text-[11px] text-stone-500 truncate">{c.title ? `${c.title} · ` : ""}{c.email}</div>
                </div>
              </div>
            )) : <p className="text-xs text-stone-600 py-2">No contacts.</p>}
          </Panel>

          <Panel title="Deals" count={data.opportunities?.length ?? 0}>
            {data.opportunities?.length ? data.opportunities.map((o: any) => (
              <Link key={o.id} href={o.leadId ? `/admin/leads/${o.leadId}` : (data.account.leadId ? `/admin/leads/${data.account.leadId}` : "/admin/leads")} className="flex items-center justify-between py-1.5 hover:bg-stone-800/30 rounded px-1 -mx-1">
                <div className="min-w-0">
                  <div className="text-sm text-stone-200 truncate">{o.title}</div>
                  <div className="text-[11px] text-stone-500 capitalize">{o.stage}{o.invoiceStatus ? ` · invoice ${o.invoiceStatus}` : ""}</div>
                </div>
                <span className="text-xs text-stone-300 tabular-nums shrink-0">{o.value ? money(o.value, o.currency) : "—"}</span>
              </Link>
            )) : <p className="text-xs text-stone-600 py-2">No deals.</p>}
          </Panel>

          <QuotesPanel accountId={a.id} orgId={a.organisationId} quotes={data.quotes ?? []} onChange={load} />

          <Panel title="Tasks" count={data.tasks?.length ?? 0}>
            {data.tasks?.length ? data.tasks.map((t: any) => (
              <div key={t.id} className="flex items-center gap-2 py-1.5">
                <CheckSquare size={13} className={t.completedAt ? "text-emerald-400" : "text-stone-600"} />
                <span className={`text-sm flex-1 truncate ${t.completedAt ? "text-stone-500 line-through" : "text-stone-200"}`}>{t.title}</span>
                {t.dueDate && <span className="text-[11px] text-stone-500 shrink-0">{when(t.dueDate).split(" · ")[0]}</span>}
              </div>
            )) : <p className="text-xs text-stone-600 py-2">No tasks.</p>}
          </Panel>

          <Panel title="Emails" count={data.emailThreads?.length ?? 0}>
            {data.emailThreads?.length ? data.emailThreads.slice(0, 8).map((t: any) => (
              <div key={t.threadKey} className="py-1.5 border-b border-stone-800/40 last:border-0">
                <div className="flex items-center gap-1.5">
                  <Mail size={11} className="text-stone-500 shrink-0" />
                  <span className="text-[13px] text-stone-200 truncate flex-1">{t.subject || "(no subject)"}</span>
                  {t.count > 1 && <span className="text-[10px] text-stone-600">{t.count}</span>}
                </div>
                {t.messages?.[0] && (
                  <p className="text-[11px] text-stone-500 truncate mt-0.5 pl-[18px]">
                    <span className={t.messages[0].direction === "inbound" ? "text-emerald-400" : "text-sky-400"}>{t.messages[0].direction === "inbound" ? "↓" : "↑"}</span> {t.messages[0].snippet || t.messages[0].fromAddr}
                  </p>
                )}
              </div>
            )) : <p className="text-xs text-stone-600 py-2">No emails yet.</p>}
          </Panel>

          {sub && (
            <Panel title="Billing">
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-stone-500 text-xs">Plan</span><span className="text-stone-200">{sub.planName ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-stone-500 text-xs">Price</span><span className="text-stone-200">{sub.planAmount ? `${money(sub.planAmount / 100, sub.planCurrency)}${sub.planInterval ? `/${sub.planInterval}` : ""}` : "—"}</span></div>
                <div className="flex justify-between"><span className="text-stone-500 text-xs">Status</span><span className="text-stone-200 capitalize">{sub.status}</span></div>
                <div className="flex justify-between"><span className="text-stone-500 text-xs">Source</span><span className="text-stone-200 capitalize">{sub.source}</span></div>
              </div>
            </Panel>
          )}

          {/* Invoice history — the full billing record, in the cockpit. */}
          {a.organisationId && (
            <Panel title="Invoices" count={billing?.invoices?.length ?? 0}
              action={<Link href={`/admin/customers/${a.organisationId}`} className="text-[11px] text-sky-400 hover:text-sky-300">Billing tools →</Link>}>
              {billing?.invoices?.length ? billing.invoices.slice(0, 8).map((inv: any) => (
                <div key={inv.id} className="flex items-center gap-2 py-1.5 border-b border-stone-800/40 last:border-0">
                  <FileText size={12} className="text-stone-500 shrink-0" />
                  <span className="font-mono text-[11px] text-stone-400 shrink-0">{inv.number ?? inv.id.slice(0, 10)}</span>
                  <span className="text-sm text-stone-200 tabular-nums">{money((inv.total ?? 0) / 100, inv.currency)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${inv.status === "paid" ? "bg-emerald-500/15 text-emerald-300" : inv.status === "open" ? "bg-amber-500/15 text-amber-300" : "bg-stone-700 text-stone-400"}`}>{inv.status}</span>
                  <span className="ml-auto text-[11px] text-stone-600 shrink-0">{inv.created ? new Date(inv.created).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : ""}</span>
                  {inv.hostedInvoiceUrl && <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-stone-500 hover:text-sky-400 shrink-0"><ExternalLink size={12} /></a>}
                </div>
              )) : <p className="text-xs text-stone-600 py-2">No invoices yet.</p>}
            </Panel>
          )}
        </div>

        {/* Right: activity timeline (spans 2 cols) */}
        <div className="lg:col-span-2">
          <Panel title="Activity timeline" count={data.activities?.length ?? 0}>
            {data.activities?.length ? (
              <div className="relative pl-5">
                <div className="absolute left-[7px] top-1 bottom-1 w-px bg-stone-800" />
                {data.activities.map((ev: any) => {
                  const cfg = ACT[ev.type] ?? { icon: Clock, cls: "text-stone-500" };
                  const Icon = cfg.icon;
                  return (
                    <div key={ev.id} className="relative pb-4 last:pb-0">
                      <div className="absolute -left-5 top-0.5 w-4 h-4 rounded-full bg-stone-900 border border-stone-700 flex items-center justify-center">
                        <Icon size={9} className={cfg.cls} />
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm text-stone-200">{ev.title}</p>
                        <span className="text-[11px] text-stone-600 shrink-0 whitespace-nowrap">{when(ev.occurredAt)}</span>
                      </div>
                      {ev.body && <p className="text-[12px] text-stone-500 mt-0.5">{ev.body}</p>}
                      {ev.actorName && <p className="text-[11px] text-stone-600 mt-0.5">{ev.actorName}</p>}
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-xs text-stone-600 py-6 text-center">No activity yet. As emails, notes, tasks, deals and invoices happen, they'll appear here.</p>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
