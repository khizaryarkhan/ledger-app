"use client";

import { useEffect, useState, useCallback } from "react";
import { Zap, Plus, X, Loader, Pause, Play, Pencil, Trash2, ChevronLeft, Mail, RefreshCw } from "lucide-react";

type Seq = {
  id: string; name: string; description: string | null; isActive: boolean; stepCount: number;
  enrolled: number; active: number; completed: number; cancelled: number; sent: number; pending: number; failed: number;
};
type Step = { id: string; stepNumber: number; delayDays: number; subject: string; body: string };

export default function WorkflowsPage() {
  const [seqs, setSeqs] = useState<Seq[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Seq | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/sequences").then(r => r.ok ? r.json() : []).then(d => setSeqs(Array.isArray(d) ? d : [])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const name = window.prompt("Workflow name (e.g. New Lead Nurture):");
    if (!name?.trim()) return;
    const r = await fetch("/api/admin/sequences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
    if (r.ok) { const d = await r.json(); load(); setEditing(d); }
  };
  const toggle = async (s: Seq) => {
    setSeqs(p => p.map(x => x.id === s.id ? { ...x, isActive: !x.isActive } : x));
    await fetch(`/api/admin/sequences/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !s.isActive }) }).catch(() => {});
  };
  const refreshDefaults = async () => {
    if (!confirm("Refresh built-in workflows with Prime Accountax copy? Step content will be overwritten; enrolment history is preserved.")) return;
    setRefreshing(true);
    try {
      const r = await fetch("/api/admin/leads/seed-defaults", { method: "POST" });
      if (r.ok) { await load(); }
    } finally { setRefreshing(false); }
  };

  const remove = async (s: Seq) => {
    if (!confirm(`Delete workflow "${s.name}"? Active enrolments stop.`)) return;
    setSeqs(p => p.filter(x => x.id !== s.id));
    await fetch(`/api/admin/sequences/${s.id}`, { method: "DELETE" }).catch(() => {});
  };

  if (editing) return <WorkflowEditor seq={editing} onBack={() => { setEditing(null); load(); }} />;

  return (
    <div className="max-w-[1000px] mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Workflows</h1>
          <p className="text-xs text-stone-500 mt-0.5">Automated email sequences — enrol a lead and steps send on schedule. A reply auto-stops the workflow.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refreshDefaults} disabled={refreshing} title="Overwrite built-in workflows with correct Prime Accountax copy" className="flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg border border-stone-700 text-stone-400 hover:text-stone-200 hover:border-stone-600 disabled:opacity-50">
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh defaults
          </button>
          <button onClick={create} className="flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"><Plus size={14} /> New workflow</button>
        </div>
      </div>

      {loading ? (
        <div className="h-48 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" />
      ) : seqs.length === 0 ? (
        <div className="py-20 text-center border border-stone-800 rounded-xl">
          <Zap size={26} className="text-stone-700 mx-auto mb-3" />
          <p className="text-sm text-stone-400">No workflows yet.</p>
          <p className="text-xs text-stone-600 mt-1 mb-4">Load the built-in Prime Accountax sequence or create one from scratch.</p>
          <button onClick={refreshDefaults} disabled={refreshing} className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 disabled:opacity-50">
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> Load defaults
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {seqs.map(s => (
            <div key={s.id} className="rounded-xl border border-stone-800 bg-stone-900/40 p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0"><Zap size={15} className="text-purple-400" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{s.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.isActive ? "bg-emerald-500/15 text-emerald-300" : "bg-stone-700 text-stone-400"}`}>{s.isActive ? "active" : "paused"}</span>
                    <span className="text-[10px] text-stone-600">{s.stepCount} step{s.stepCount !== 1 ? "s" : ""}</span>
                  </div>
                  {s.description && <p className="text-[11px] text-stone-500 mt-0.5 truncate">{s.description}</p>}
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-stone-500">
                    <span><span className="text-stone-300 font-semibold tabular-nums">{s.enrolled ?? 0}</span> enrolled</span>
                    <span><span className="text-emerald-400 font-semibold tabular-nums">{s.active ?? 0}</span> active</span>
                    <span><span className="text-sky-400 font-semibold tabular-nums">{s.sent ?? 0}</span> sent</span>
                    <span><span className="text-stone-300 font-semibold tabular-nums">{s.completed ?? 0}</span> completed</span>
                    {(s.failed ?? 0) > 0 && <span className="text-rose-400">{s.failed} failed</span>}
                    {(s.pending ?? 0) > 0 && <span><span className="text-amber-400 font-semibold tabular-nums">{s.pending}</span> queued</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggle(s)} title={s.isActive ? "Pause" : "Activate"} className="p-1.5 rounded hover:bg-stone-800 text-stone-500 hover:text-stone-200">{s.isActive ? <Pause size={13} /> : <Play size={13} />}</button>
                  <button onClick={() => setEditing(s)} className="p-1.5 rounded hover:bg-stone-800 text-stone-500 hover:text-stone-200"><Pencil size={13} /></button>
                  <button onClick={() => remove(s)} className="p-1.5 rounded hover:bg-rose-500/15 text-stone-500 hover:text-rose-400"><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowEditor({ seq, onBack }: { seq: Seq; onBack: () => void }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ delayDays: "3", subject: "", body: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/sequences/${seq.id}/steps`).then(r => r.ok ? r.json() : []).then(d => setSteps(Array.isArray(d) ? d : [])).finally(() => setLoading(false));
  }, [seq.id]);
  useEffect(() => { load(); }, [load]);

  const addStep = async () => {
    if (!form.subject.trim() || !form.body.trim()) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/sequences/${seq.id}/steps`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (r.ok) { setForm({ delayDays: "3", subject: "", body: "" }); setAdding(false); load(); }
    } finally { setSaving(false); }
  };
  const delStep = async (id: string) => { setSteps(p => p.filter(s => s.id !== id)); await fetch(`/api/admin/sequences/${seq.id}/steps/${id}`, { method: "DELETE" }).catch(() => {}); };

  const inp = "w-full px-3 py-2 text-sm rounded-lg bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";

  return (
    <div className="max-w-[800px] mx-auto">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-300 mb-3"><ChevronLeft size={14} /> Workflows</button>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-white">{seq.name}</h1>
        <button onClick={() => setAdding(a => !a)} className="flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"><Plus size={14} /> Add step</button>
      </div>

      {adding && (
        <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-4 mb-4 space-y-3">
          <div className="flex items-center gap-2"><label className="text-xs text-stone-400">Send after</label><input className={`${inp} w-20`} value={form.delayDays} onChange={e => setForm(f => ({ ...f, delayDays: e.target.value }))} inputMode="numeric" /><span className="text-xs text-stone-500">days</span></div>
          <input className={inp} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Subject — use {{firstName}}, {{companyName}}" />
          <textarea className={inp} rows={5} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="Email body…" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="h-8 px-3 text-xs rounded-lg border border-stone-700 text-stone-300">Cancel</button>
            <button onClick={addStep} disabled={saving} className="h-8 px-3 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60">{saving ? "Saving…" : "Add step"}</button>
          </div>
        </div>
      )}

      {loading ? <div className="h-32 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" /> : steps.length === 0 ? (
        <p className="text-sm text-stone-500 py-8 text-center border border-stone-800 rounded-xl">No steps yet — add the first email.</p>
      ) : (
        <div className="space-y-2">
          {steps.map(s => (
            <div key={s.id} className="rounded-xl border border-stone-800 bg-stone-900/40 p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-6 h-6 rounded-full bg-stone-800 text-stone-300 text-[11px] flex items-center justify-center font-semibold">{s.stepNumber}</span>
                <Mail size={13} className="text-stone-500" />
                <span className="text-sm font-medium text-stone-100">{s.subject}</span>
                <span className="ml-auto text-[11px] text-stone-500">{s.delayDays === 0 ? "immediately" : `+${s.delayDays}d`}</span>
                <button onClick={() => delStep(s.id)} className="p-1 rounded hover:bg-rose-500/15 text-stone-500 hover:text-rose-400"><Trash2 size={12} /></button>
              </div>
              <p className="text-[12px] text-stone-500 whitespace-pre-wrap line-clamp-3 pl-8">{s.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
