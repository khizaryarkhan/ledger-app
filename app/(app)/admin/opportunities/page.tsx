"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { OPP_STAGES } from "@/lib/opportunities";
import {
  Plus, LayoutGrid, List as ListIcon, Loader, X, Trash2, TrendingUp,
  Trophy, Target, CircleDollarSign, GripVertical, Receipt,
} from "lucide-react";

type Opp = {
  id: string; leadId: string | null; orgId: string | null;
  title: string; value: number; currency: string; confidence: number;
  stage: string; status: string; expectedCloseDate: string | null;
  leadName?: string | null; leadCompany?: string | null; ownerName?: string | null;
};
type Lead = { id: string; fullName: string; companyName?: string | null };

const TONE: Record<string, { dot: string; bar: string; ring: string; text: string }> = {
  sky:     { dot: "bg-sky-400",     bar: "bg-sky-500",     ring: "border-sky-500/40",     text: "text-sky-300" },
  blue:    { dot: "bg-blue-400",    bar: "bg-blue-500",    ring: "border-blue-500/40",    text: "text-blue-300" },
  violet:  { dot: "bg-violet-400",  bar: "bg-violet-500",  ring: "border-violet-500/40",  text: "text-violet-300" },
  amber:   { dot: "bg-amber-400",   bar: "bg-amber-500",   ring: "border-amber-500/40",   text: "text-amber-300" },
  emerald: { dot: "bg-emerald-400", bar: "bg-emerald-500", ring: "border-emerald-500/40", text: "text-emerald-300" },
  rose:    { dot: "bg-rose-400",    bar: "bg-rose-500",    ring: "border-rose-500/40",    text: "text-rose-300" },
};

function money(v: number, ccy = "USD") {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(v || 0); }
  catch { return `${ccy} ${v}`; }
}

export default function OpportunitiesPage() {
  const [opps, setOpps] = useState<Opp[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [view, setView] = useState<"pipeline" | "list">("pipeline");
  const [editing, setEditing] = useState<Opp | null>(null);
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/opportunities").then(r => r.ok ? r.json() : { opportunities: [] }),
      fetch("/api/admin/leads").then(r => r.ok ? r.json() : { leads: [] }),
    ]).then(([o, l]) => {
      setOpps(o.opportunities ?? []);
      setNeedsSetup(!!o.needsSetup);
      setLeads(l.leads ?? []);
    }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); } }, [toast]);

  // Metrics
  const m = useMemo(() => {
    const open = opps.filter(o => o.status === "open");
    const won = opps.filter(o => o.status === "won");
    const pipeline = open.reduce((s, o) => s + (o.value || 0), 0);
    const forecast = open.reduce((s, o) => s + (o.value || 0) * (o.confidence || 0) / 100, 0);
    const wonValue = won.reduce((s, o) => s + (o.value || 0), 0);
    return { openCount: open.length, pipeline, forecast: Math.round(forecast), wonCount: won.length, wonValue };
  }, [opps]);

  const moveStage = async (id: string, stage: string) => {
    const prev = opps;
    setOpps(os => os.map(o => o.id === id ? { ...o, stage, status: OPP_STAGES.find(s => s.key === stage)?.terminal ?? "open" } : o));
    try {
      const r = await fetch(`/api/admin/opportunities/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage }) });
      if (!r.ok) throw new Error();
      setToast({ ok: true, msg: `Moved to ${OPP_STAGES.find(s => s.key === stage)?.label}` });
      load();
    } catch { setOpps(prev); setToast({ ok: false, msg: "Failed to move" }); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this opportunity?")) return;
    setOpps(os => os.filter(o => o.id !== id));
    await fetch(`/api/admin/opportunities/${id}`, { method: "DELETE" });
    setToast({ ok: true, msg: "Deleted" });
  };

  return (
    <div className="max-w-[1500px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Opportunities</h1>
          <p className="text-xs text-stone-500 mt-0.5">Your deal pipeline — value, confidence and forecast across every stage.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-stone-700 overflow-hidden">
            <button onClick={() => setView("pipeline")} className={`flex items-center gap-1.5 h-9 px-3 text-xs font-medium ${view === "pipeline" ? "bg-stone-800 text-white" : "text-stone-400 hover:bg-stone-900"}`}><LayoutGrid size={14} /> Pipeline</button>
            <button onClick={() => setView("list")} className={`flex items-center gap-1.5 h-9 px-3 text-xs font-medium ${view === "list" ? "bg-stone-800 text-white" : "text-stone-400 hover:bg-stone-900"}`}><ListIcon size={14} /> List</button>
          </div>
          <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"><Plus size={14} /> New deal</button>
        </div>
      </div>

      {needsSetup && (
        <div className="mb-4 rounded-lg ring-1 ring-amber-500/30 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-300">
          The <span className="font-mono">opportunities</span> table isn't set up yet — create it in Neon (SQL provided by your developer), then deals will save here.
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Open pipeline", value: money(m.pipeline), icon: CircleDollarSign, accent: "text-stone-200" },
          { label: "Weighted forecast", value: money(m.forecast), icon: Target, accent: "text-sky-400" },
          { label: "Won value", value: money(m.wonValue), icon: Trophy, accent: "text-emerald-400" },
          { label: "Open deals", value: String(m.openCount), icon: TrendingUp, accent: "text-stone-200" },
        ].map(c => (
          <div key={c.label} className="rounded-xl border border-stone-800 bg-stone-900/50 p-3.5">
            <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-stone-500">{c.label}</span><c.icon size={13} className={c.accent} /></div>
            <p className={`text-xl font-semibold tabular-nums ${c.accent}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="h-72 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" />
      ) : view === "pipeline" ? (
        <PipelineBoard opps={opps} dragId={dragId} setDragId={setDragId} onDrop={moveStage} onOpen={setEditing} />
      ) : (
        <OppTable opps={opps} onOpen={setEditing} onDelete={remove} />
      )}

      {(creating || editing) && (
        <OppModal
          opp={editing} leads={leads}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); setToast({ ok: true, msg: "Saved" }); }}
          onToast={setToast}
        />
      )}

      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-xl ${toast.ok ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{toast.msg}</div>
      )}
    </div>
  );
}

// ── Pipeline (Kanban) ──────────────────────────────────────────────────────────
function PipelineBoard({ opps, dragId, setDragId, onDrop, onOpen }: {
  opps: Opp[]; dragId: string | null; setDragId: (id: string | null) => void;
  onDrop: (id: string, stage: string) => void; onOpen: (o: Opp) => void;
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3 min-w-[1100px]">
        {OPP_STAGES.map(stage => {
          const cards = opps.filter(o => o.stage === stage.key);
          const sum = cards.reduce((s, o) => s + (o.value || 0), 0);
          const tone = TONE[stage.tone];
          return (
            <div key={stage.key}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { if (dragId) { onDrop(dragId, stage.key); setDragId(null); } }}
              className={`flex-1 min-w-[200px] rounded-xl border ${tone.ring} bg-stone-900/40`}>
              <div className="px-3 py-2 border-b border-stone-800">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${tone.dot}`} />
                  <span className="text-xs font-semibold text-white">{stage.label}</span>
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-stone-800 text-stone-400">{cards.length}</span>
                </div>
                <p className="text-[11px] text-stone-500 mt-1 tabular-nums">{cards.length ? money(sum, cards[0].currency) : "—"}</p>
              </div>
              <div className="p-2 space-y-2 min-h-[140px] max-h-[62vh] overflow-y-auto">
                {cards.map(o => (
                  <div key={o.id} draggable
                    onDragStart={() => setDragId(o.id)} onDragEnd={() => setDragId(null)}
                    onClick={() => onOpen(o)}
                    className={`group rounded-lg border border-stone-800 bg-stone-900 p-2.5 cursor-pointer hover:border-stone-600 ${dragId === o.id ? "opacity-50" : ""}`}>
                    <div className="flex items-start gap-1.5">
                      <GripVertical size={12} className="text-stone-700 mt-0.5 shrink-0 cursor-grab" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-stone-200 truncate">{o.title}</p>
                        {(o.leadCompany || o.leadName) && <p className="text-[11px] text-stone-500 truncate">{o.leadCompany || o.leadName}</p>}
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2 pl-4">
                      <span className="text-[12px] font-semibold text-stone-200 tabular-nums">{money(o.value, o.currency)}</span>
                      <span className="text-[10px] text-stone-500">{o.confidence}%</span>
                    </div>
                    {o.expectedCloseDate && (
                      <p className="text-[10px] text-stone-600 mt-1 pl-4">close {new Date(o.expectedCloseDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
                    )}
                  </div>
                ))}
                {cards.length === 0 && <p className="text-[11px] text-stone-600 text-center py-4">Drop deals here</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── List ────────────────────────────────────────────────────────────────────
function OppTable({ opps, onOpen, onDelete }: { opps: Opp[]; onOpen: (o: Opp) => void; onDelete: (id: string) => void }) {
  if (!opps.length) return <div className="py-20 text-center text-sm text-stone-500 border border-stone-800 rounded-xl">No deals yet — create your first with “New deal”.</div>;
  return (
    <div className="rounded-xl border border-stone-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-stone-800 bg-stone-900/40">
          {["Deal", "Lead / Company", "Value", "Confidence", "Stage", "Close", "Owner", ""].map(h =>
            <th key={h} className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-stone-500 font-semibold">{h}</th>)}
        </tr></thead>
        <tbody>
          {opps.map(o => {
            const tone = TONE[OPP_STAGES.find(s => s.key === o.stage)?.tone ?? "sky"];
            return (
              <tr key={o.id} className="border-b border-stone-800/50 hover:bg-stone-800/20 group">
                <td className="px-4 py-2.5 cursor-pointer" onClick={() => onOpen(o)}><span className="text-stone-200 font-medium">{o.title}</span></td>
                <td className="px-4 py-2.5 text-stone-400">{o.leadCompany || o.leadName || "—"}</td>
                <td className="px-4 py-2.5 text-stone-200 tabular-nums font-medium">{money(o.value, o.currency)}</td>
                <td className="px-4 py-2.5 text-stone-400 tabular-nums">{o.confidence}%</td>
                <td className="px-4 py-2.5"><span className={`text-[11px] font-medium ${tone.text}`}>{OPP_STAGES.find(s => s.key === o.stage)?.label ?? o.stage}</span></td>
                <td className="px-4 py-2.5 text-stone-500 text-xs whitespace-nowrap">{o.expectedCloseDate ? new Date(o.expectedCloseDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                <td className="px-4 py-2.5 text-stone-500 text-xs">{o.ownerName || "—"}</td>
                <td className="px-4 py-2.5 text-right"><button onClick={() => onDelete(o.id)} className="p-1 rounded hover:bg-rose-500/15 text-stone-600 hover:text-rose-400 opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Create / edit modal ────────────────────────────────────────────────────────
function OppModal({ opp, leads, onClose, onSaved, onToast }: {
  opp: Opp | null; leads: Lead[]; onClose: () => void; onSaved: () => void; onToast: (t: { ok: boolean; msg: string }) => void;
}) {
  const [title, setTitle] = useState(opp?.title ?? "");
  const [leadId, setLeadId] = useState(opp?.leadId ?? "");
  const [value, setValue] = useState(String(opp?.value ?? ""));
  const [currency, setCurrency] = useState(opp?.currency ?? "USD");
  const [confidence, setConfidence] = useState(String(opp?.confidence ?? 50));
  const [stage, setStage] = useState(opp?.stage ?? "discovery");
  const [closeDate, setCloseDate] = useState(opp?.expectedCloseDate ? opp.expectedCloseDate.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);

  const inp = "w-full px-3 py-2 text-[13px] rounded-md bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";
  const lbl = "text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1";

  const save = async () => {
    if (!title.trim()) { onToast({ ok: false, msg: "Title is required" }); return; }
    setSaving(true);
    const body = {
      title: title.trim(), leadId: leadId || null, stage,
      value: value ? parseInt(value) : 0, currency, confidence: parseInt(confidence) || 0,
      expectedCloseDate: closeDate || null,
    };
    try {
      const r = await fetch(opp ? `/api/admin/opportunities/${opp.id}` : "/api/admin/opportunities", {
        method: opp ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) onSaved(); else onToast({ ok: false, msg: d.error ?? "Save failed" });
    } catch { onToast({ ok: false, msg: "Save failed" }); }
    finally { setSaving(false); }
  };

  const isWon = opp?.status === "won";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-stone-900 rounded-xl w-full max-w-lg ring-1 ring-stone-800 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800">
          <h2 className="text-sm font-semibold text-white">{opp ? "Edit deal" : "New deal"}</h2>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-300"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div><label className={lbl}>Deal title</label><input className={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Acme Foods — Pro plan" autoFocus /></div>
          <div><label className={lbl}>Lead</label>
            <select className={inp} value={leadId} onChange={e => setLeadId(e.target.value)}>
              <option value="">— none —</option>
              {leads.map(l => <option key={l.id} value={l.id}>{l.companyName ? `${l.companyName} · ${l.fullName}` : l.fullName}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2"><label className={lbl}>Value</label>
              <input className={inp} type="number" min={0} value={value} onChange={e => setValue(e.target.value)} placeholder="5000" /></div>
            <div><label className={lbl}>Currency</label>
              <select className={inp} value={currency} onChange={e => setCurrency(e.target.value)}>
                {["USD", "EUR", "GBP", "CAD", "AUD"].map(c => <option key={c} value={c}>{c}</option>)}
              </select></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl}>Stage</label>
              <select className={inp} value={stage} onChange={e => setStage(e.target.value)}>
                {OPP_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select></div>
            <div><label className={lbl}>Confidence %</label>
              <input className={inp} type="number" min={0} max={100} value={confidence} onChange={e => setConfidence(e.target.value)} /></div>
          </div>
          <div><label className={lbl}>Expected close date</label><input className={inp} type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} /></div>

          {isWon && (
            <div className="rounded-lg ring-1 ring-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 flex items-center gap-2">
              <Receipt size={14} className="text-emerald-400 shrink-0" />
              <span className="text-[12px] text-emerald-300">This deal is won. Create the customer's first Stripe invoice from the billing cockpit on the Overview page.</span>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-stone-800">
          <button onClick={onClose} className="h-9 px-4 text-xs font-medium rounded-lg text-stone-400 hover:bg-stone-800">Cancel</button>
          <button onClick={save} disabled={saving} className="h-9 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 text-white flex items-center gap-1.5">
            {saving && <Loader size={13} className="animate-spin" />} {opp ? "Save" : "Create deal"}
          </button>
        </div>
      </div>
    </div>
  );
}
