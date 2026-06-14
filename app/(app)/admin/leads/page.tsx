"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Search, FileText, Loader, X, Plus, Mail, Globe, UserPlus } from "lucide-react";
import { Card, Badge, Button, Toast } from "@/components/ui";

const STATUS_OPTIONS = ["new", "contacted", "qualified", "converted", "rejected", "archived"] as const;
type LeadStatus = typeof STATUS_OPTIONS[number];

const STATUS_COLOR: Record<LeadStatus, string> = {
  new:       "blue",
  contacted: "yellow",
  qualified: "green",
  converted: "emerald",
  rejected:  "neutral",
  archived:  "neutral",
};

const STATUS_LABEL: Record<LeadStatus, string> = {
  new:       "New",
  contacted: "Contacted",
  qualified: "Qualified",
  converted: "Converted",
  rejected:  "Rejected",
  archived:  "Archived",
};

// ── Inline status changer ──────────────────────────────────────────────────
function StatusCell({ lead, onChange }: { lead: any; onChange: (id: string, status: string) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const pick = async (s: string) => {
    setOpen(false);
    if (s === lead.status) return;
    setSaving(true);
    await fetch(`/api/admin/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: s }),
    });
    onChange(lead.id, s);
    setSaving(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        disabled={saving}
        className="focus:outline-none"
      >
        {saving
          ? <Loader size={12} className="animate-spin text-stone-400" />
          : <Badge variant={STATUS_COLOR[lead.status as LeadStatus] as any} size="sm" className="cursor-pointer hover:opacity-80 transition-opacity">{STATUS_LABEL[lead.status as LeadStatus] ?? lead.status}</Badge>
        }
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-36 bg-stone-800 border border-stone-700 rounded-lg shadow-xl overflow-hidden">
          {STATUS_OPTIONS.map(s => (
            <button key={s} onClick={() => pick(s)}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
                s === lead.status ? "bg-stone-700 text-white font-medium" : "text-stone-300 hover:bg-stone-700"
              }`}>
              <Badge variant={STATUS_COLOR[s] as any} size="sm">{STATUS_LABEL[s]}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Add Lead modal ─────────────────────────────────────────────────────────
function AddLeadModal({ onClose, onSaved }: { onClose: () => void; onSaved: (lead: any) => void }) {
  const [form, setForm] = useState({
    fullName: "", email: "", companyName: "", phone: "",
    country: "", interestedService: "", message: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/admin/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to add lead"); return; }
      onSaved(data);
      onClose();
    } finally { setSaving(false); }
  };

  const canSubmit = !saving && !!form.fullName.trim() && !!form.email.trim();

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-md shadow-xl ring-1 ring-stone-800">
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center">
              <UserPlus size={13} className="text-blue-400" />
            </div>
            <h2 className="font-semibold text-white text-sm">Add lead manually</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={15} /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="text-xs text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30">{error}</div>}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Full name <span className="text-rose-400">*</span></label>
              <input value={form.fullName} onChange={e => set("fullName", e.target.value)} placeholder="Jane Smith"
                className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Email <span className="text-rose-400">*</span></label>
              <input type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="jane@company.com"
                className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Company</label>
              <input value={form.companyName} onChange={e => set("companyName", e.target.value)} placeholder="Acme Ltd"
                className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Phone</label>
              <input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="+353 1 234 5678"
                className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Country</label>
              <input value={form.country} onChange={e => set("country", e.target.value)} placeholder="Ireland"
                className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Interested in</label>
              <input value={form.interestedService} onChange={e => set("interestedService", e.target.value)} placeholder="AR Automation"
                className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-emerald-500 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Notes / Message</label>
            <textarea value={form.message} onChange={e => set("message", e.target.value)} rows={2} placeholder="Context about this lead…"
              className="w-full px-3 py-2 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 resize-none focus:ring-emerald-500 focus:outline-none" />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
          <button onClick={onClose} className="h-8 px-3 text-xs rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={!canSubmit}
            className="h-8 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 disabled:text-stone-500 text-white transition-colors flex items-center gap-1.5">
            {saving && <Loader size={11} className="animate-spin" />}
            Add lead
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Lead detail modal ──────────────────────────────────────────────────────
function LeadModal({ lead, onClose, onSave, onStatusChange }: any) {
  const [status, setStatus] = useState<LeadStatus>(lead?.status ?? "new");
  const [notes, setNotes]   = useState(lead?.adminNotes ?? "");
  const [saving, setSaving] = useState(false);

  if (!lead) return null;

  const handleSave = async () => {
    setSaving(true);
    await onSave(lead.id, status, notes);
    setSaving(false);
  };

  const firstName = lead.fullName?.split(" ")[0] ?? "";
  const mailtoHref = `mailto:${lead.email}?subject=${encodeURIComponent("Prime Accountax — Following up")}&body=${encodeURIComponent(`Hi ${firstName},\n\n`)}`;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-lg shadow-xl ring-1 ring-stone-800 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-800 flex items-start justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-white text-sm">{lead.fullName ?? "Lead"}</h2>
            <p className="text-[11px] text-stone-500 mt-0.5">{lead.companyName ? `${lead.companyName} · ` : ""}{lead.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <a href={mailtoHref}
              className="flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium rounded-lg bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors">
              <Mail size={11} /> Email
            </a>
            <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={15} /></button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Contact info */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            {[
              ["Phone",        lead.phone       ?? "—"],
              ["Country",      lead.country     ?? "—"],
              ["Company size", lead.companySize ?? "—"],
              ["Service",      lead.interestedService ?? "—"],
              ["Source",       lead.source ?? "landing_page"],
              ["Received",     new Date(lead.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[10px] text-stone-500 mb-0.5 uppercase tracking-wider font-semibold">{label}</p>
                <p className="text-stone-200">{value}</p>
              </div>
            ))}
          </div>

          {lead.message && (
            <div className="p-3 bg-stone-800/60 rounded-lg">
              <p className="text-[10px] text-stone-500 mb-1.5 uppercase tracking-wider font-semibold">Message</p>
              <p className="text-xs text-stone-300 whitespace-pre-wrap leading-relaxed">{lead.message}</p>
            </div>
          )}

          {(lead.utmSource || lead.utmMedium || lead.utmCampaign) && (
            <div className="flex gap-2 flex-wrap">
              {lead.utmSource   && <span className="text-[10px] text-stone-500 bg-stone-800 px-2 py-0.5 rounded font-mono">src: {lead.utmSource}</span>}
              {lead.utmMedium   && <span className="text-[10px] text-stone-500 bg-stone-800 px-2 py-0.5 rounded font-mono">med: {lead.utmMedium}</span>}
              {lead.utmCampaign && <span className="text-[10px] text-stone-500 bg-stone-800 px-2 py-0.5 rounded font-mono">cmp: {lead.utmCampaign}</span>}
            </div>
          )}

          {/* Status */}
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1.5">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value as LeadStatus)}
              className="w-full h-8 px-2.5 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 focus:ring-emerald-500 focus:outline-none">
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1.5">
              Admin notes <span className="normal-case text-stone-600 font-normal">(internal)</span>
            </label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} maxLength={2000}
              placeholder="Notes about this lead…"
              className="w-full px-3 py-2 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800/60 text-white placeholder-stone-500 resize-none focus:ring-emerald-500 focus:outline-none leading-relaxed"
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="h-8 px-3 text-xs rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors">Close</button>
          <button onClick={handleSave} disabled={saving}
            className="h-8 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 disabled:text-stone-500 text-white transition-colors flex items-center gap-1.5">
            {saving && <Loader size={11} className="animate-spin" />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function LeadsPage() {
  const [leads, setLeads]       = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [active, setActive]     = useState<any>(null);
  const [toast, setToast]       = useState<any>(null);
  const [search, setSearch]     = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdd, setShowAdd]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("q", search);
      const r = await fetch(`/api/admin/leads?${params}`);
      if (r.ok) setLeads((await r.json()).leads ?? []);
    } finally { setLoading(false); }
  }, [statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (id: string, newStatus: string, adminNotes: string) => {
    const r = await fetch(`/api/admin/leads/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: newStatus, adminNotes }),
    });
    if (r.ok) {
      setToast({ type: "success", message: "Lead updated" });
      setActive(null);
      load();
    } else {
      const d = await r.json().catch(() => ({}));
      setToast({ type: "error", message: d.error ?? "Failed to update lead" });
    }
  };

  const handleInlineStatusChange = (id: string, newStatus: string) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status: newStatus } : l));
  };

  const handleLeadAdded = (lead: any) => {
    setLeads(prev => [lead, ...prev]);
    setToast({ type: "success", message: `${lead.fullName} added as a lead` });
  };

  // Pipeline stats from current result set
  const stats = {
    total:     leads.length,
    new:       leads.filter(l => l.status === "new").length,
    inProgress: leads.filter(l => l.status === "contacted" || l.status === "qualified").length,
    converted: leads.filter(l => l.status === "converted").length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">Leads</h1>
          <p className="text-xs text-stone-500 mt-0.5">Prospects and enquiries — landing page &amp; manually added</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">
          <Plus size={13} /> Add lead
        </button>
      </div>

      {/* Stats bar */}
      {!loading && leads.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total",       value: stats.total,      color: "text-white",       bg: "bg-stone-900" },
            { label: "New",         value: stats.new,        color: "text-blue-400",    bg: "bg-blue-500/8" },
            { label: "In progress", value: stats.inProgress, color: "text-amber-400",   bg: "bg-amber-500/8" },
            { label: "Converted",   value: stats.converted,  color: "text-emerald-400", bg: "bg-emerald-500/8" },
          ].map(s => (
            <div key={s.label} className={`rounded-xl border border-stone-800 ${s.bg} px-4 py-3`}>
              <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
              <p className="text-[11px] text-stone-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, company…"
            className="w-full h-8 pl-8 pr-3 text-xs rounded-md border border-stone-700 bg-stone-800 text-stone-200 placeholder-stone-500 focus:outline-none focus:border-emerald-500"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300">
              <X size={12} />
            </button>
          )}
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="h-8 px-2.5 text-xs rounded-md border border-stone-700 bg-stone-800 text-stone-200 focus:outline-none focus:border-emerald-500">
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <button onClick={load} disabled={loading}
          className="h-8 px-3 text-xs text-stone-400 hover:text-stone-200 rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 transition-colors flex items-center gap-1.5 disabled:opacity-50">
          {loading ? <Loader size={11} className="animate-spin" /> : "Refresh"}
        </button>
      </div>

      {/* Table */}
      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-2.5">
            {[1,2,3,4,5].map(i => <div key={i} className="h-11 bg-stone-800 rounded animate-pulse" />)}
          </div>
        ) : !leads.length ? (
          <div className="py-20 text-center">
            <FileText size={26} className="text-stone-700 mx-auto mb-3" />
            <p className="text-sm text-stone-500 font-medium">No leads found</p>
            <p className="text-xs text-stone-600 mt-1">
              {search || statusFilter !== "all" ? "Try adjusting your filters" : "Add your first lead or wait for landing page enquiries"}
            </p>
            {!search && statusFilter === "all" && (
              <button onClick={() => setShowAdd(true)}
                className="mt-4 flex items-center gap-1.5 h-8 px-4 text-xs font-medium rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 transition-colors mx-auto">
                <Plus size={12} /> Add lead
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800">
                {["Name / Company", "Email", "Service", "Status", "Source", "Received", ""].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-stone-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((l: any) => {
                const mailtoHref = `mailto:${l.email}?subject=${encodeURIComponent("Prime Accountax — Following up")}&body=${encodeURIComponent(`Hi ${l.fullName?.split(" ")[0] ?? ""},\n\n`)}`;
                return (
                  <tr key={l.id} className="border-b border-stone-800/50 hover:bg-stone-800/20 transition-colors group">
                    <td className="px-4 py-3 cursor-pointer" onClick={() => setActive(l)}>
                      <p className="text-white text-xs font-medium">{l.fullName ?? "—"}</p>
                      {l.companyName && <p className="text-[11px] text-stone-500 mt-0.5">{l.companyName}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-300 max-w-[160px]">
                      <span className="truncate block">{l.email}</span>
                      {l.phone && <span className="text-[11px] text-stone-500">{l.phone}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-400 max-w-[120px] truncate">{l.interestedService ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StatusCell lead={l} onChange={handleInlineStatusChange} />
                    </td>
                    <td className="px-4 py-3">
                      {l.source === "manual"
                        ? <span className="inline-flex items-center gap-1 text-[10px] font-medium text-stone-500 bg-stone-800 px-1.5 py-0.5 rounded"><UserPlus size={9} /> Manual</span>
                        : <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded"><Globe size={9} /> Website</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-500 whitespace-nowrap">
                      {new Date(l.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <a href={mailtoHref}
                          onClick={e => e.stopPropagation()}
                          title="Email this lead"
                          className="p-1.5 rounded hover:bg-blue-500/15 text-stone-500 hover:text-blue-400 transition-colors">
                          <Mail size={13} />
                        </a>
                        <button onClick={() => setActive(l)}
                          className="text-[10px] px-2 py-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition-colors font-medium">
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {showAdd && <AddLeadModal onClose={() => setShowAdd(false)} onSaved={handleLeadAdded} />}
      {active  && <LeadModal lead={active} onClose={() => setActive(null)} onSave={handleSave} onStatusChange={handleInlineStatusChange} />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
