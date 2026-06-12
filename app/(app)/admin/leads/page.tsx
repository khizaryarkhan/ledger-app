"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, FileText, Loader, X } from "lucide-react";
import { Card, Badge, Button, Modal, Toast } from "@/components/ui";

const STATUS_OPTIONS = ["new", "contacted", "qualified", "converted", "rejected", "archived"];

const STATUS_BADGE: Record<string, string> = {
  new:       "blue",
  contacted: "yellow",
  qualified: "green",
  converted: "emerald",
  rejected:  "neutral",
  archived:  "neutral",
};

function LeadModal({ lead, onClose, onSave }: any) {
  const [status, setStatus] = useState(lead?.status ?? "new");
  const [notes, setNotes]   = useState(lead?.adminNotes ?? "");
  const [saving, setSaving] = useState(false);

  if (!lead) return null;

  const handleSave = async () => {
    setSaving(true);
    await onSave(lead.id, status, notes);
    setSaving(false);
  };

  return (
    <Modal open={!!lead} onClose={onClose} title="Lead Details" size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving && <Loader size={14} className="animate-spin mr-1" />}
            Save changes
          </Button>
        </>
      }
    >
      <div className="px-5 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[
            ["Full name",    lead.fullName    ?? "—"],
            ["Company",      lead.companyName ?? "—"],
            ["Email",        lead.email       ?? "—"],
            ["Phone",        lead.phone       ?? "—"],
            ["Country",      lead.country     ?? "—"],
            ["Company size", lead.companySize ?? "—"],
            ["Service",      lead.interestedService ?? "—"],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[11px] text-stone-500 mb-0.5">{label}</p>
              <p className="text-white text-xs">{value}</p>
            </div>
          ))}
        </div>

        {lead.message && (
          <div className="p-3 bg-stone-800/60 rounded-lg">
            <p className="text-[11px] text-stone-500 mb-1">Message</p>
            <p className="text-sm text-stone-300 whitespace-pre-wrap">{lead.message}</p>
          </div>
        )}

        {(lead.utmSource || lead.utmMedium || lead.utmCampaign) && (
          <div className="flex gap-2 flex-wrap">
            {lead.utmSource && <span className="text-[11px] text-stone-500 bg-stone-800 px-2 py-0.5 rounded">source: {lead.utmSource}</span>}
            {lead.utmMedium && <span className="text-[11px] text-stone-500 bg-stone-800 px-2 py-0.5 rounded">medium: {lead.utmMedium}</span>}
            {lead.utmCampaign && <span className="text-[11px] text-stone-500 bg-stone-800 px-2 py-0.5 rounded">campaign: {lead.utmCampaign}</span>}
          </div>
        )}

        <div>
          <label className="text-xs text-stone-400 mb-1.5 block font-medium">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="h-8 px-2.5 text-xs rounded-md border border-stone-700 bg-stone-800 text-stone-200 focus:outline-none w-full">
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs text-stone-400 mb-1.5 block">Admin notes <span className="text-stone-600">(internal)</span></label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} maxLength={2000}
            placeholder="Notes about this lead…"
            className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 resize-none focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>
    </Modal>
  );
}

export default function LeadsPage() {
  const [leads, setLeads]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive]   = useState<any>(null);
  const [toast, setToast]     = useState<any>(null);
  const [search, setSearch]   = useState("");
  const [status, setStatus]   = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (search)           params.set("search", search);
      const r = await fetch(`/api/admin/leads?${params}`);
      if (r.ok) setLeads((await r.json()).leads ?? []);
    } finally { setLoading(false); }
  }, [status, search]);

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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">Leads</h1>
          <p className="text-xs text-stone-500 mt-0.5">Landing page enquiries and demo requests</p>
        </div>
        <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader size={12} className="animate-spin" /> : "Refresh"}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-500" />
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
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="h-8 px-2.5 text-xs rounded-md border border-stone-700 bg-stone-800 text-stone-200 focus:outline-none">
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-12 bg-stone-800 rounded animate-pulse" />)}</div>
        ) : !leads.length ? (
          <div className="py-16 text-center">
            <FileText size={28} className="text-stone-600 mx-auto mb-3" />
            <p className="text-sm text-stone-500">No leads found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800">
                {["Name / Company", "Email", "Service", "Status", "Received", ""].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] text-stone-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((l: any) => (
                <tr key={l.id} className="border-b border-stone-800/50 hover:bg-stone-800/30 transition-colors cursor-pointer"
                  onClick={() => setActive(l)}>
                  <td className="px-4 py-3">
                    <p className="text-white text-xs font-medium">{l.fullName ?? "—"}</p>
                    <p className="text-[11px] text-stone-500">{l.companyName ?? ""}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-300 truncate max-w-[160px]">{l.email}</td>
                  <td className="px-4 py-3 text-xs text-stone-400 truncate max-w-[120px]">{l.interestedService ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_BADGE[l.status] as any}>{l.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-500">
                    {new Date(l.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-4 py-3">
                    <button className="text-xs text-stone-500 hover:text-stone-300 transition-colors">View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {active && <LeadModal lead={active} onClose={() => setActive(null)} onSave={handleSave} />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
