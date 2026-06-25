"use client";

import Link from "next/link";
import { useEffect, useState, useMemo, useCallback } from "react";
import { OPP_STAGES } from "@/lib/opportunities";
import { COUNTRIES } from "@/lib/countries";
import {
  Plus, LayoutGrid, List as ListIcon, Loader, X, Trash2, TrendingUp, Trophy,
  Target, CircleDollarSign, GripVertical, Receipt, AlertTriangle, Activity,
  ChevronRight, Sparkles,
} from "lucide-react";

type Opp = {
  id: string; leadId: string | null; orgId: string | null;
  title: string; value: number; currency: string; confidence: number;
  stage: string; status: string; expectedCloseDate: string | null; updatedAt: string | null;
  leadName?: string | null; leadCompany?: string | null; ownerName?: string | null;
  invoiceStatus?: string | null; invoiceTotal?: number | null; invoiceCurrency?: string | null; invoiceUrl?: string | null;
};
type Lead = { id: string; fullName: string; companyName?: string | null };

const TONE: Record<string, { dot: string; ring: string; text: string; bar: string }> = {
  sky:     { dot: "bg-sky-400",     ring: "border-sky-500/30",     text: "text-sky-300",     bar: "bg-sky-500" },
  blue:    { dot: "bg-blue-400",    ring: "border-blue-500/30",    text: "text-blue-300",    bar: "bg-blue-500" },
  violet:  { dot: "bg-violet-400",  ring: "border-violet-500/30",  text: "text-violet-300",  bar: "bg-violet-500" },
  amber:   { dot: "bg-amber-400",   ring: "border-amber-500/30",   text: "text-amber-300",   bar: "bg-amber-500" },
  emerald: { dot: "bg-emerald-400", ring: "border-emerald-500/30", text: "text-emerald-300", bar: "bg-emerald-500" },
  rose:    { dot: "bg-rose-400",    ring: "border-rose-500/30",    text: "text-rose-300",    bar: "bg-rose-500" },
};

function money(v: number, ccy = "USD") {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(v || 0); } catch { return `${ccy} ${v}`; }
}
function initials(n?: string | null) { return (n || "?").split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase(); }

// Deterministic deal-risk signal from close date + staleness + confidence.
function risk(o: Opp): { tone: "emerald" | "amber" | "rose"; label: string } {
  if (o.status !== "open") return { tone: "emerald", label: o.status === "won" ? "won" : "lost" };
  const now = Date.now();
  if (o.expectedCloseDate && new Date(o.expectedCloseDate).getTime() < now) return { tone: "rose", label: "overdue" };
  const ageDays = o.updatedAt ? (now - new Date(o.updatedAt).getTime()) / 86400000 : 0;
  if (ageDays > 14) return { tone: "rose", label: "stalled" };
  if (ageDays > 7 || (o.confidence ?? 0) < 30) return { tone: "amber", label: "watch" };
  return { tone: "emerald", label: "on track" };
}

export default function OpportunitiesPage() {
  const [opps, setOpps] = useState<Opp[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [view, setView] = useState<"pipeline" | "list" | "forecast" | "health">("pipeline");
  const [editing, setEditing] = useState<Opp | null>(null);
  const [creating, setCreating] = useState(false);
  const [invoicing, setInvoicing] = useState<Opp | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/opportunities").then(r => r.ok ? r.json() : { opportunities: [] }),
      fetch("/api/admin/leads").then(r => r.ok ? r.json() : { leads: [] }),
    ]).then(([o, l]) => { setOpps(o.opportunities ?? []); setNeedsSetup(!!o.needsSetup); setLeads(l.leads ?? []); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); } }, [toast]);

  const m = useMemo(() => {
    const open = opps.filter(o => o.status === "open");
    const won = opps.filter(o => o.status === "won");
    return {
      openCount: open.length,
      pipeline: open.reduce((s, o) => s + (o.value || 0), 0),
      forecast: Math.round(open.reduce((s, o) => s + (o.value || 0) * (o.confidence || 0) / 100, 0)),
      wonValue: won.reduce((s, o) => s + (o.value || 0), 0),
      atRisk: open.filter(o => risk(o).tone !== "emerald").length,
    };
  }, [opps]);

  const moveStage = async (id: string, stage: string) => {
    const prev = opps;
    setOpps(os => os.map(o => o.id === id ? { ...o, stage, status: OPP_STAGES.find(s => s.key === stage)?.terminal ?? "open" } : o));
    try {
      const r = await fetch(`/api/admin/opportunities/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage }) });
      if (!r.ok) throw new Error(); setToast({ ok: true, msg: `Moved to ${OPP_STAGES.find(s => s.key === stage)?.label}` }); load();
    } catch { setOpps(prev); setToast({ ok: false, msg: "Failed to move" }); }
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this opportunity?")) return;
    setOpps(os => os.filter(o => o.id !== id));
    await fetch(`/api/admin/opportunities/${id}`, { method: "DELETE" }); setToast({ ok: true, msg: "Deleted" });
  };

  const VIEWS = [
    { k: "pipeline", label: "Board", icon: LayoutGrid },
    { k: "list", label: "List", icon: ListIcon },
    { k: "forecast", label: "Forecast", icon: Target },
    { k: "health", label: "Health", icon: Activity },
  ] as const;

  return (
    <div className="max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Opportunities</h1>
          <p className="text-xs text-stone-500 mt-0.5">Your deal pipeline — value, confidence and forecast across every stage.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-stone-700 overflow-hidden">
            {VIEWS.map(v => (
              <button key={v.k} onClick={() => setView(v.k)} className={`flex items-center gap-1.5 h-9 px-3 text-xs font-medium ${view === v.k ? "bg-stone-800 text-white" : "text-stone-400 hover:bg-stone-900"}`}>
                <v.icon size={13} /> {v.label}
              </button>
            ))}
          </div>
          <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"><Plus size={14} /> New deal</button>
        </div>
      </div>

      {needsSetup && (
        <div className="mb-4 rounded-lg ring-1 ring-amber-500/30 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-300">
          The <span className="font-mono">opportunities</span> table isn't set up yet — create it in Neon, then deals will save here.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Open pipeline", value: money(m.pipeline), icon: CircleDollarSign, accent: "text-stone-100" },
          { label: "Weighted forecast", value: money(m.forecast), icon: Target, accent: "text-sky-400" },
          { label: "Won value", value: money(m.wonValue), icon: Trophy, accent: "text-emerald-400" },
          { label: "At risk", value: String(m.atRisk), icon: AlertTriangle, accent: m.atRisk ? "text-rose-400" : "text-stone-100" },
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
        <Board opps={opps} dragId={dragId} setDragId={setDragId} onDrop={moveStage} onOpen={setEditing} onNew={() => setCreating(true)} onInvoice={setInvoicing} />
      ) : view === "list" ? (
        <OppTable opps={opps} onOpen={setEditing} onDelete={remove} onInvoice={setInvoicing} />
      ) : view === "forecast" ? (
        <Forecast opps={opps} />
      ) : (
        <Health opps={opps} />
      )}

      {(creating || editing) && (
        <OppModal opp={editing} leads={leads}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); setToast({ ok: true, msg: "Saved" }); }}
          onInvoice={(o: Opp) => { setEditing(null); setInvoicing(o); }}
          onToast={setToast} />
      )}
      {invoicing && (
        <InvoiceModal opp={invoicing} onClose={() => setInvoicing(null)}
          onSent={() => { setInvoicing(null); load(); setToast({ ok: true, msg: "Invoice created & sent via Stripe" }); }}
          onToast={setToast} />
      )}
      {toast && <div className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-xl ${toast.ok ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{toast.msg}</div>}
    </div>
  );
}

// ── Board ──────────────────────────────────────────────────────────────────────
function Board({ opps, dragId, setDragId, onDrop, onOpen, onNew, onInvoice }: any) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3 min-w-[1180px]">
        {OPP_STAGES.map((stage: any) => {
          const cards = opps.filter((o: Opp) => o.stage === stage.key);
          const sum = cards.reduce((s: number, o: Opp) => s + (o.value || 0), 0);
          const tone = TONE[stage.tone];
          return (
            <div key={stage.key} onDragOver={(e: any) => e.preventDefault()} onDrop={() => { if (dragId) { onDrop(dragId, stage.key); setDragId(null); } }}
              className={`flex-1 min-w-[210px] rounded-2xl border ${tone.ring} bg-stone-900/30`}>
              <div className="px-3.5 py-3 border-b border-stone-800/80">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${tone.dot}`} />
                  <span className="text-[12.5px] font-semibold text-white">{stage.label}</span>
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-stone-800 text-stone-400">{cards.length}</span>
                </div>
                <p className="text-[12px] text-stone-400 mt-1.5 tabular-nums font-medium">{cards.length ? money(sum, cards[0].currency) : "—"}</p>
              </div>
              <div className="p-2.5 space-y-2.5 min-h-[180px] max-h-[64vh] overflow-y-auto">
                {cards.map((o: Opp) => {
                  const rk = risk(o); const rt = TONE[rk.tone];
                  return (
                    <div key={o.id} draggable onDragStart={() => setDragId(o.id)} onDragEnd={() => setDragId(null)} onClick={() => onOpen(o)}
                      className={`group rounded-xl border border-stone-800 bg-stone-900 p-3 cursor-pointer hover:border-stone-600 transition-colors ${dragId === o.id ? "opacity-50" : ""}`}>
                      <div className="flex items-start gap-1.5">
                        <GripVertical size={12} className="text-stone-700 mt-0.5 shrink-0 cursor-grab" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-stone-100 truncate">{o.title}</p>
                          {(o.leadCompany || o.leadName) && <p className="text-[11px] text-stone-500 truncate">{o.leadCompany || o.leadName}</p>}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2.5 pl-4">
                        <span className="text-[14px] font-semibold text-stone-100 tabular-nums">{money(o.value, o.currency)}</span>
                        <span className="text-[10px] text-stone-500">{o.confidence}%</span>
                      </div>
                      <div className="mt-1.5 pl-4 h-1.5 rounded-full bg-stone-800 overflow-hidden"><span className={`block h-full ${tone.bar}`} style={{ width: `${o.confidence}%` }} /></div>
                      <div className="flex items-center justify-between mt-2.5 pl-4">
                        <span className={`inline-flex items-center gap-1 text-[10px] ${rt.text}`}><span className={`w-1.5 h-1.5 rounded-full ${rt.dot}`} /> {rk.label}</span>
                        <div className="flex items-center gap-2">
                          {o.expectedCloseDate && <span className="text-[10px] text-stone-600">{new Date(o.expectedCloseDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                          <span className="w-5 h-5 rounded-full bg-stone-800 flex items-center justify-center text-[9px] text-stone-400" title={o.ownerName || ""}>{initials(o.ownerName)}</span>
                        </div>
                      </div>
                      {o.status === "won" && (
                        o.invoiceStatus ? (
                          <div className="mt-2.5 ml-4 flex items-center gap-1.5 text-[11px]">
                            <Receipt size={12} className={o.invoiceStatus === "paid" ? "text-emerald-400" : "text-sky-400"} />
                            <span className="text-stone-300">{o.invoiceTotal != null ? money((o.invoiceTotal || 0) / 100, (o.invoiceCurrency || o.currency || "USD").toUpperCase()) : "Invoiced"}</span>
                            <span className={`px-1.5 py-0.5 rounded ${o.invoiceStatus === "paid" ? "bg-emerald-500/15 text-emerald-300" : "bg-sky-500/15 text-sky-300"}`}>{o.invoiceStatus}</span>
                            {o.invoiceUrl && <a href={o.invoiceUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="ml-auto text-stone-500 hover:text-emerald-400">view</a>}
                          </div>
                        ) : (
                          <button onClick={e => { e.stopPropagation(); onInvoice(o); }}
                            className="mt-2.5 ml-4 inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-semibold rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white">
                            <Receipt size={12} /> Create invoice
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
                {cards.length === 0 && (
                  <button onClick={onNew} className="w-full text-[11px] text-stone-600 hover:text-stone-400 py-6 rounded-xl border border-dashed border-stone-800 hover:border-stone-700 transition-colors">+ Add deal</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── List ──────────────────────────────────────────────────────────────────────
function OppTable({ opps, onOpen, onDelete, onInvoice }: any) {
  if (!opps.length) return <Empty onText="No deals yet — create your first with “New deal”." />;
  return (
    <div className="rounded-xl border border-stone-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-stone-800 bg-stone-900/40">
          {["Deal", "Lead", "Value", "Confidence", "Stage", "Risk", "Close", "Owner", ""].map(h =>
            <th key={h} className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-stone-500 font-semibold">{h}</th>)}
        </tr></thead>
        <tbody>
          {opps.map((o: Opp) => {
            const tone = TONE[OPP_STAGES.find((s: any) => s.key === o.stage)?.tone ?? "sky"]; const rk = risk(o); const rt = TONE[rk.tone];
            return (
              <tr key={o.id} className="border-b border-stone-800/50 hover:bg-stone-800/20 group">
                <td className="px-4 py-2.5 cursor-pointer" onClick={() => onOpen(o)}><span className="text-stone-100 font-medium">{o.title}</span></td>
                <td className="px-4 py-2.5">{o.leadId ? <Link href={`/admin/leads/${o.leadId}`} className="text-stone-300 hover:text-emerald-400">{o.leadCompany || o.leadName || "View lead"}</Link> : <span className="text-stone-500">—</span>}</td>
                <td className="px-4 py-2.5 text-stone-100 tabular-nums font-medium">{money(o.value, o.currency)}</td>
                <td className="px-4 py-2.5 text-stone-400 tabular-nums">{o.confidence}%</td>
                <td className="px-4 py-2.5"><span className={`text-[11px] font-medium ${tone.text}`}>{OPP_STAGES.find((s: any) => s.key === o.stage)?.label ?? o.stage}</span></td>
                <td className="px-4 py-2.5"><span className={`inline-flex items-center gap-1 text-[11px] ${rt.text}`}><span className={`w-1.5 h-1.5 rounded-full ${rt.dot}`} /> {rk.label}</span></td>
                <td className="px-4 py-2.5 text-stone-500 text-xs whitespace-nowrap">{o.expectedCloseDate ? new Date(o.expectedCloseDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                <td className="px-4 py-2.5 text-stone-500 text-xs">{o.ownerName || "—"}</td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {o.status === "won" && <button onClick={() => onInvoice(o)} title="Create invoice" className="p-1 rounded hover:bg-emerald-500/15 text-stone-500 hover:text-emerald-400"><Receipt size={13} /></button>}
                    <button onClick={() => onDelete(o.id)} className="p-1 rounded hover:bg-rose-500/15 text-stone-600 hover:text-rose-400 opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Forecast ────────────────────────────────────────────────────────────────────
function Forecast({ opps }: { opps: Opp[] }) {
  const open = opps.filter(o => o.status === "open");
  if (!open.length) return <Empty onText="No open deals to forecast yet." />;
  const rows = OPP_STAGES.filter((s: any) => !s.terminal).map((s: any) => {
    const d = open.filter(o => o.stage === s.key);
    const total = d.reduce((a, o) => a + (o.value || 0), 0);
    const weighted = Math.round(d.reduce((a, o) => a + (o.value || 0) * (o.confidence || 0) / 100, 0));
    return { stage: s, count: d.length, total, weighted };
  });
  const grand = rows.reduce((a, r) => a + r.weighted, 0);
  const max = Math.max(...rows.map(r => r.total), 1);
  return (
    <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[12px] font-semibold text-stone-300 uppercase tracking-wider">Weighted forecast by stage</span>
        <span className="text-xl font-semibold text-sky-400 tabular-nums">{money(grand)}</span>
      </div>
      <div className="space-y-3">
        {rows.map(r => { const tone = TONE[r.stage.tone]; return (
          <div key={r.stage.key} className="flex items-center gap-3">
            <span className="w-28 text-[12.5px] text-stone-300 flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${tone.dot}`} />{r.stage.label}</span>
            <div className="flex-1 h-6 rounded-md bg-stone-800/60 overflow-hidden"><div className={`h-full ${tone.bar} opacity-80`} style={{ width: `${(r.total / max) * 100}%` }} /></div>
            <span className="w-12 text-right text-[11px] text-stone-500">{r.count} deal{r.count !== 1 ? "s" : ""}</span>
            <span className="w-24 text-right text-[12.5px] text-stone-200 tabular-nums">{money(r.weighted)}</span>
          </div>
        ); })}
      </div>
    </div>
  );
}

// ── Health ──────────────────────────────────────────────────────────────────────
function Health({ opps }: { opps: Opp[] }) {
  const flagged = opps.filter(o => o.status === "open" && risk(o).tone !== "emerald")
    .sort((a, b) => (b.value || 0) - (a.value || 0));
  if (!flagged.length) return <Empty icon={Sparkles} onText="Pipeline looks healthy — no at-risk deals." />;
  return (
    <div className="rounded-xl border border-stone-800 overflow-hidden">
      {flagged.map(o => { const rk = risk(o); const rt = TONE[rk.tone]; return (
        <div key={o.id} className="flex items-center gap-3 px-4 py-3 border-b border-stone-800/50 hover:bg-stone-800/20">
          <AlertTriangle size={15} className={rt.text} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-stone-100">{o.title} <span className="text-stone-500">· {money(o.value, o.currency)}</span></p>
            <p className="text-[11px] text-stone-500">{o.leadCompany || o.leadName || "—"} · {OPP_STAGES.find((s: any) => s.key === o.stage)?.label} · {o.confidence}%</p>
          </div>
          <span className={`text-[11px] font-medium ${rt.text}`}>{rk.label}</span>
          {o.leadId && <Link href={`/admin/leads/${o.leadId}`} className="text-stone-500 hover:text-emerald-400"><ChevronRight size={16} /></Link>}
        </div>
      ); })}
    </div>
  );
}

function Empty({ onText, icon: Icon = Receipt }: { onText: string; icon?: any }) {
  return <div className="py-20 text-center border border-stone-800 rounded-xl"><Icon size={24} className="text-stone-700 mx-auto mb-3" /><p className="text-sm text-stone-500">{onText}</p></div>;
}

// ── Create / edit modal ────────────────────────────────────────────────────────
function OppModal({ opp, leads, onClose, onSaved, onInvoice, onToast }: {
  opp: Opp | null; leads: Lead[]; onClose: () => void; onSaved: () => void; onInvoice: (o: Opp) => void; onToast: (t: { ok: boolean; msg: string }) => void;
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
    const body = { title: title.trim(), leadId: leadId || null, stage, value: value ? parseInt(value) : 0, currency, confidence: parseInt(confidence) || 0, expectedCloseDate: closeDate || null };
    try {
      const r = await fetch(opp ? `/api/admin/opportunities/${opp.id}` : "/api/admin/opportunities", { method: opp ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) onSaved(); else onToast({ ok: false, msg: d.error ?? "Save failed" });
    } catch { onToast({ ok: false, msg: "Save failed" }); } finally { setSaving(false); }
  };
  const isWon = opp?.status === "won";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-stone-900 rounded-xl w-full max-w-lg ring-1 ring-stone-800 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800"><h2 className="text-sm font-semibold text-white">{opp ? "Edit deal" : "New deal"}</h2><button onClick={onClose} className="text-stone-500 hover:text-stone-300"><X size={18} /></button></div>
        <div className="p-5 space-y-3">
          <div><label className={lbl}>Deal title</label><input className={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Acme Foods — Pro plan" autoFocus /></div>
          <div><label className={lbl}>Lead</label>
            <select className={inp} value={leadId} onChange={e => setLeadId(e.target.value)}>
              <option value="">— none —</option>
              {leads.map(l => <option key={l.id} value={l.id}>{l.companyName ? `${l.companyName} · ${l.fullName}` : l.fullName}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2"><label className={lbl}>Value</label><input className={inp} type="number" min={0} value={value} onChange={e => setValue(e.target.value)} placeholder="5000" /></div>
            <div><label className={lbl}>Currency</label><select className={inp} value={currency} onChange={e => setCurrency(e.target.value)}>{["USD","EUR","GBP","CAD","AUD"].map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl}>Stage</label><select className={inp} value={stage} onChange={e => setStage(e.target.value)}>{OPP_STAGES.map((s: any) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
            <div><label className={lbl}>Confidence %</label><input className={inp} type="number" min={0} max={100} value={confidence} onChange={e => setConfidence(e.target.value)} /></div>
          </div>
          <div><label className={lbl}>Expected close date</label><input className={inp} type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} /></div>
          {isWon && (
            <div className="rounded-lg ring-1 ring-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 flex items-center gap-2.5">
              <Receipt size={14} className="text-emerald-400 shrink-0" />
              <span className="text-[12px] text-emerald-300 flex-1">This deal is won — invoice the customer in one click.</span>
              <button onClick={() => opp && onInvoice(opp)} className="h-7 px-2.5 text-[11px] font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white whitespace-nowrap">Create invoice</button>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-stone-800">
          <button onClick={onClose} className="h-9 px-4 text-xs font-medium rounded-lg text-stone-400 hover:bg-stone-800">Cancel</button>
          <button onClick={save} disabled={saving} className="h-9 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 text-white flex items-center gap-1.5">{saving && <Loader size={13} className="animate-spin" />} {opp ? "Save" : "Create deal"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Create invoice from a won deal (Lead → Customer bridge → Stripe) ─────────────
function matchCountryCode(val?: string | null): string {
  if (!val) return "";
  const v = val.trim();
  const byCode = COUNTRIES.find(c => c.code.toLowerCase() === v.toLowerCase());
  if (byCode) return byCode.code;
  const byName = COUNTRIES.find(c => c.name.toLowerCase() === v.toLowerCase());
  return byName ? byName.code : "";
}

type CatItem = { id: string; name: string; description: string | null; unitAmount: number; currency: string };
type Line = { itemId: string; description: string; qty: string; unitPrice: string };

function InvoiceModal({ opp, onClose, onSent, onToast }: {
  opp: Opp; onClose: () => void; onSent: () => void; onToast: (t: { ok: boolean; msg: string }) => void;
}) {
  const [prep, setPrep] = useState(true);
  const [orgId, setOrgId] = useState<string | null>(opp.orgId ?? null);
  const [catalog, setCatalog] = useState<CatItem[]>([]);
  const [mode, setMode] = useState<"oneoff" | "subscription">("oneoff");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", description: opp.title || "", qty: "1", unitPrice: String(opp.value || "") }]);
  const [subAmount, setSubAmount] = useState(String(opp.value || ""));
  const [planName, setPlanName] = useState(opp.title || "Subscription");
  const [currency, setCurrency] = useState((opp.currency || "EUR").toLowerCase());
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [country, setCountry] = useState("");
  const [dueDays, setDueDays] = useState("14");
  const [memo, setMemo] = useState("");
  const [createAccount, setCreateAccount] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/admin/opportunities/${opp.id}/customer`, { method: "POST" })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not set up customer"); return d; })
      .then(d => { setOrgId(d.orgId); if (d.billingEmail) setEmail(d.billingEmail); setCountry(matchCountryCode(d.country)); setCompanyName(d.name || ""); })
      .catch(e => setErr(e.message))
      .finally(() => setPrep(false));
    fetch("/api/admin/items").then(r => r.ok ? r.json() : { items: [] }).then(d => setCatalog((d.items ?? []).filter((i: any) => i.active !== false))).catch(() => {});
  }, [opp.id]);

  const inp = "w-full px-3 py-2 text-[13px] rounded-md bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";
  const lbl = "text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1";

  const setLine = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l));
  const pickItem = (i: number, itemId: string) => {
    if (!itemId) { setLine(i, { itemId: "" }); return; }
    const it = catalog.find(c => c.id === itemId);
    if (it) { setLine(i, { itemId, description: it.name, unitPrice: String((it.unitAmount / 100).toFixed(2)) }); if (it.currency) setCurrency(it.currency); }
  };
  const addLine = () => setLines(ls => [...ls, { itemId: "", description: "", qty: "1", unitPrice: "" }]);
  const delLine = (i: number) => setLines(ls => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls);
  const lineTotal = (l: Line) => (parseFloat(l.qty) || 0) * (parseFloat(l.unitPrice) || 0);
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  const cur = (n: number) => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(n); } catch { return `${currency.toUpperCase()} ${n.toFixed(2)}`; } };

  const send = async () => {
    if (!orgId) { setErr("Customer not ready"); return; }
    if (!companyName.trim()) { onToast({ ok: false, msg: "Company name is required" }); return; }
    if (!email.trim()) { onToast({ ok: false, msg: "Billing email required" }); return; }
    setSending(true); setErr("");
    // Set the customer/organisation name first so the Stripe customer + Customers
    // list use the name the admin typed (not the guessed one).
    try { await fetch(`/api/admin/opportunities/${opp.id}/customer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: companyName.trim() }) }); } catch {}
    const body: any = { orgId, mode, billingEmail: email.trim(), currency, country: country || undefined, daysUntilDue: parseInt(dueDays) || 14, memo: memo.trim() || undefined };
    if (mode === "subscription") {
      const amt = Math.round((parseFloat(subAmount) || 0) * 100);
      if (amt <= 0) { onToast({ ok: false, msg: "Enter a recurring amount" }); setSending(false); return; }
      body.amount = amt; body.interval = interval; body.planName = planName || "Subscription";
    } else {
      const items = lines
        .map(l => { const qty = parseFloat(l.qty) || 0; const amt = Math.round(lineTotal(l) * 100); const desc = (l.description || "Item").slice(0, 480); return { description: qty > 1 ? `${desc} (×${qty})` : desc, amount: amt }; })
        .filter(li => li.amount > 0);
      if (!items.length) { onToast({ ok: false, msg: "Add at least one line item with an amount" }); setSending(false); return; }
      body.lineItems = items;
    }
    try {
      const r = await fetch("/api/admin/billing/create-invoice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || "Failed to create invoice"); onToast({ ok: false, msg: d.error || "Failed" }); setSending(false); return; }
      // Record the invoice on the deal itself (single source of truth on the opportunity).
      const sentTotal = d.total ?? (mode === "subscription" ? Math.round((parseFloat(subAmount) || 0) * 100) : Math.round(total * 100));
      try {
        await fetch(`/api/admin/opportunities/${opp.id}`, { method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ stripeInvoiceId: d.invoiceId ?? null, invoiceUrl: d.hostedInvoiceUrl ?? null, invoiceTotal: sentTotal, invoiceCurrency: d.currency ?? currency, invoiceStatus: d.status ?? "open", invoicedAt: new Date().toISOString() }) });
      } catch {}
      if (createAccount) {
        try { await fetch(`/api/admin/opportunities/${opp.id}/customer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provision: true, email: email.trim() }) }); } catch {}
      }
      setResult(d); // show confirmation with the invoice link instead of closing
    } catch { setErr("Failed to create invoice"); } finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-stone-900 rounded-xl w-full max-w-2xl ring-1 ring-stone-800 shadow-xl flex flex-col" style={{ maxHeight: "92vh" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-800 shrink-0">
          <div className="flex items-center gap-2"><Receipt size={15} className="text-emerald-400" /><h2 className="text-sm font-semibold text-white">Create invoice — {opp.title}</h2></div>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-300"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {result ? (
            <div className="py-2">
              <div className="flex items-center gap-2.5 mb-3"><span className="w-9 h-9 rounded-full bg-emerald-500/15 flex items-center justify-center"><Receipt size={16} className="text-emerald-400" /></span>
                <div><p className="text-sm font-semibold text-white">Invoice created &amp; sent</p><p className="text-[12px] text-stone-500">Stripe emailed it to {email}</p></div></div>
              <div className="rounded-lg border border-stone-800 bg-stone-900/60 divide-y divide-stone-800/60">
                {result.number && <div className="flex justify-between px-3 py-2 text-[13px]"><span className="text-stone-500">Invoice</span><span className="text-stone-200 font-mono">{result.number}</span></div>}
                {result.total != null && <div className="flex justify-between px-3 py-2 text-[13px]"><span className="text-stone-500">Total</span><span className="text-stone-100 font-semibold tabular-nums">{cur((result.total || 0) / 100)}</span></div>}
                <div className="flex justify-between px-3 py-2 text-[13px]"><span className="text-stone-500">Status</span><span className="text-emerald-300 capitalize">{result.status || "open"}</span></div>
              </div>
              {result.hostedInvoiceUrl && (
                <a href={result.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer"
                  className="mt-3 w-full inline-flex items-center justify-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg border border-stone-700 text-stone-200 hover:bg-stone-800"><ChevronRight size={13} /> View / pay invoice</a>
              )}
              <p className="text-[11px] text-stone-600 mt-3">Track it anytime under <span className="text-stone-400">Customers</span> → this customer → Invoices.</p>
            </div>
          ) : prep ? (
            <div className="flex items-center gap-2 text-[13px] text-stone-400 py-4"><Loader size={14} className="animate-spin" /> Setting up the customer…</div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="flex rounded-lg border border-stone-700 overflow-hidden w-fit">
                  <button onClick={() => setMode("oneoff")} className={`h-8 px-3 text-xs font-medium ${mode === "oneoff" ? "bg-stone-800 text-white" : "text-stone-400"}`}>One-off</button>
                  <button onClick={() => setMode("subscription")} className={`h-8 px-3 text-xs font-medium ${mode === "subscription" ? "bg-stone-800 text-white" : "text-stone-400"}`}>Recurring</button>
                </div>
                <select className="h-8 px-2 text-xs rounded-md bg-stone-800 border border-stone-700 text-stone-200" value={currency} onChange={e => setCurrency(e.target.value)}>{["eur","usd","gbp","cad","aud"].map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}</select>
              </div>

              <div><label className={lbl}>Company / customer name</label><input className={inp} value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Acme Foods Ltd" /></div>

              {mode === "oneoff" ? (
                <div>
                  <div className="grid grid-cols-[1fr_64px_110px_96px_32px] gap-2 px-1 mb-1">
                    {["Item / description", "Qty", "Unit price", "Amount", ""].map((h, i) => <span key={i} className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">{h}</span>)}
                  </div>
                  <div className="space-y-1.5">
                    {lines.map((l, i) => (
                      <div key={i} className="grid grid-cols-[1fr_64px_110px_96px_32px] gap-2 items-center">
                        <div>
                          {catalog.length > 0 && (
                            <select className={`${inp} mb-1 !py-1.5 text-[12px]`} value={l.itemId} onChange={e => pickItem(i, e.target.value)}>
                              <option value="">Custom / type below…</option>
                              {catalog.map(c => <option key={c.id} value={c.id}>{c.name} — {cur(c.unitAmount / 100)}</option>)}
                            </select>
                          )}
                          <input className={inp} value={l.description} onChange={e => setLine(i, { description: e.target.value, itemId: "" })} placeholder="Description" />
                        </div>
                        <input className={`${inp} text-center`} type="number" min={1} step="1" value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} />
                        <input className={inp} type="number" min={0} step="0.01" value={l.unitPrice} onChange={e => setLine(i, { unitPrice: e.target.value })} placeholder="0.00" />
                        <span className="text-[13px] text-stone-200 tabular-nums text-right pr-1">{cur(lineTotal(l))}</span>
                        <button onClick={() => delLine(i)} disabled={lines.length === 1} className="w-8 h-9 rounded-md border border-stone-700 text-stone-500 hover:text-rose-400 disabled:opacity-30 flex items-center justify-center"><Trash2 size={13} /></button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-2.5">
                    <button onClick={addLine} className="text-[12px] font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-1"><Plus size={13} /> Add line item</button>
                    <span className="text-[13px] text-stone-300">Total <span className="font-semibold text-white tabular-nums ml-1">{cur(total)}</span></span>
                  </div>
                  {catalog.length === 0 && <p className="text-[11px] text-stone-600 mt-2">Tip: add reusable products under <span className="text-stone-400">Items</span> to pick them here.</p>}
                </div>
              ) : (
                <>
                  <div><label className={lbl}>Plan name</label><input className={inp} value={planName} onChange={e => setPlanName(e.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={lbl}>Recurring amount</label><input className={inp} type="number" min={0} step="0.01" value={subAmount} onChange={e => setSubAmount(e.target.value)} placeholder="0.00" /></div>
                    <div><label className={lbl}>Interval</label><select className={inp} value={interval} onChange={e => setInterval(e.target.value as any)}><option value="month">Monthly</option><option value="year">Annual</option></select></div>
                  </div>
                </>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2"><label className={lbl}>Billing email</label><input className={inp} value={email} onChange={e => setEmail(e.target.value)} placeholder="billing@customer.com" /></div>
                <div><label className={lbl}>Country</label>
                  <select className={inp} value={country} onChange={e => setCountry(e.target.value)}>
                    <option value="">— select —</option>
                    {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              {mode === "oneoff" && (
                <div className="grid grid-cols-3 gap-3">
                  <div><label className={lbl}>Due in (days)</label><input className={inp} type="number" min={0} value={dueDays} onChange={e => setDueDays(e.target.value)} /></div>
                  <div className="col-span-2"><label className={lbl}>Memo / notes <span className="text-stone-600 normal-case">(on the invoice)</span></label><input className={inp} value={memo} onChange={e => setMemo(e.target.value)} placeholder="e.g. Thank you for your business" /></div>
                </div>
              )}

              <label className="flex items-start gap-2.5 rounded-lg border border-stone-700 bg-stone-800/40 px-3 py-2.5 cursor-pointer">
                <input type="checkbox" checked={createAccount} onChange={e => setCreateAccount(e.target.checked)} className="mt-0.5 accent-emerald-500" />
                <span className="text-[12px] text-stone-300">Set up their app account <span className="text-stone-200">(activated on payment)</span><span className="block text-[11px] text-stone-500 mt-0.5">A pending account is created now; the set-password invite is sent automatically once the invoice is paid.</span></span>
              </label>
              <p className="text-[11px] text-stone-600">Stripe issues and emails the invoice. {mode === "subscription" ? "After the first payment it auto-charges each period from the saved card." : "A one-off invoice the customer pays online."}</p>
              {err && <p className="text-[12px] text-rose-400">{err}</p>}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-stone-800 shrink-0">
          {result ? (
            <button onClick={onSent} className="h-9 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white">Done</button>
          ) : (
            <>
              <button onClick={onClose} className="h-9 px-4 text-xs font-medium rounded-lg text-stone-400 hover:bg-stone-800">Cancel</button>
              <button onClick={send} disabled={prep || sending} className="h-9 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 text-white flex items-center gap-1.5">{sending ? <Loader size={13} className="animate-spin" /> : <Receipt size={13} />} Create &amp; send</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
