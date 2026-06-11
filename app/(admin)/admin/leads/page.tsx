"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, FileText, Loader, ChevronDown } from "lucide-react";
import { Card, Badge, Button, Modal, Toast } from "@/components/ui";

const STATUS_BADGE: Record<string, string> = {
  new:       "blue",
  contacted: "yellow",
  qualified: "purple",
  converted: "green",
  rejected:  "neutral",
  archived:  "neutral",
};

const STATUS_OPTIONS = ["new", "contacted", "qualified", "converted", "rejected", "archived"];

function LeadModal({ lead, onClose, onSave }: any) {
  const [status, setStatus] = useState(lead?.status ?? "new");
  const [notes, setNotes]   = useState(lead?.adminNotes ?? "");
  const [loading, setLoading] = useState(false);

  if (!lead) return null;

  const handleSave = async () => {
    setLoading(true);
    await onSave(lead.id, { status, adminNotes: notes });
    setLoading(false);
  };

  return (
    <Modal
      open={!!lead}
      onClose={onClose}
      title={`Lead: ${lead.fullName}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={handleSave} disabled={loading}>
            {loading ? <Loader size={14} className="animate-spin mr-1" /> : null}
            Save changes
          </Button>
        </>
      }
    >
      <div className="px-5 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-[11px] text-stone-500 mb-0.5">Full name</p>
            <p className="text-white">{lead.fullName}</p>
          </div>
          <div>
            <p className="text-[11px] text-stone-500 mb-0.5">Company</p>
            <p className="text-white">{lead.companyName ?? "—"}</p>
          </div>
          <div>
            <p className="text-[11px] text-stone-500 mb-0.5">Email</p>
            <a href={`mailto:${lead.email}`} className="text-emerald-400 hover:text-emerald-300 text-xs">{lead.email}</a>
          </div>
          <div>
            <p className="text-[11px] text-stone-500 mb-0.5">Phone</p>
            <p className="text-white text-xs">{lead.phone ?? "—"}</p>
          </div>
          {lead.companySize && (
            <div>
              <p className="text-[11px] text-stone-500 mb-0.5">Company size</p>
              <p className="text-white text-xs">{lead.companySize}</p>
            </div>
          )}
          {lead.interestedService && (
            <div>
              <p className="text-[11px] text-stone-500 mb-0.5">Interested in</p>
              <p className="text-white text-xs">{lead.interestedService}</p>
            </div>
          )}
          <div>
            <p className="text-[11px] text-stone-500 mb-0.5">Submitted</p>
            <p className="text-white text-xs">
              {new Date(lead.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-stone-500 mb-0.5">Source</p>
            <p className="text-white text-xs">{lead.source}</p>
          </div>
        </div>

        {lead.message && (
          <div className="p-3 bg-stone-800/60 rounded-lg">
            <p className="text-[11px] text-stone-500 mb-1">Message</p>
            <p className="text-sm text-stone-300">{lead.message}</p>
          </div>
        )}

        <div>
          <label className="text-xs text-stone-400 mb-1.5 block font-medium">Status</label>
          <div className="grid grid-cols-3 gap-1.5">
            {STATUS_OPTIONS.map(s => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`px-2.5 py-1.5 rounded-md text-xs capitalize transition-colors ${
                  status === s
                    ? "bg-emerald-500 text-white"
                    : "bg-stone-800 text-stone-400 hover:bg-stone-700 hover:text-stone-200"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-stone-400 mb-1.5 block">Admin notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            maxLength={5000}
            placeholder="Internal notes about this lead…"
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
  const [filter, setFilter]   = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      if (search.trim()) params.set("q", search.trim());
      const r = await fetch(`/api/admin/leads?${params}`);
      if (r.ok) {
        const d = await r.json();
        setLeads(d.leads ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (id: string, updates: any) => {
    const r = await fetch(`/api/admin/leads/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (r.ok) {
      setToast({ type: "success", message: "Lead updated" });
      // Update local state
      setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
      setActive((prev: any) => prev ? { ...prev, ...updates } : null);
    } else {
      setToast({ type: "error", message: "Failed to update lead" });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-base font-semibold text-white">Landing Page Leads</h1>
          <p className="text-xs text-stone-500 mt-0.5">Customer interest and demo requests from the landing page</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && load()}
              placeholder="Search leads…"
              className="h-8 pl-8 pr-3 text-xs rounded-md border border-stone-700 bg-stone-800 text-stone-200 placeholder-stone-500 focus:border-emerald-500 focus:outline-none w-48"
            />
          </div>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="h-8 px-2.5 text-xs rounded-md border border-stone-700 bg-stone-800 text-stone-200 focus:outline-none"
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
          </select>
        </div>
      </div>

      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-3">
            {[1,2,3,4].map(i => <div key={i} className="h-12 bg-stone-800 rounded animate-pulse" />)}
          </div>
        ) : !leads.length ? (
          <div className="py-16 text-center">
            <FileText size={28} className="text-stone-600 mx-auto mb-3" />
            <p className="text-sm text-stone-500">No leads found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800">
                {["Name", "Company", "Email", "Interested in", "Status", "Date", ""].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] text-stone-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((l: any) => (
                <tr key={l.id} className="border-b border-stone-800/50 hover:bg-stone-800/30 transition-colors cursor-pointer" onClick={() => setActive(l)}>
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{l.fullName}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-400">{l.companyName ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-stone-300 max-w-[140px] truncate">{l.email}</td>
                  <td className="px-4 py-3 text-xs text-stone-400 max-w-[120px] truncate">{l.interestedService ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_BADGE[l.status] as any}>{l.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-500">
                    {new Date(l.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-stone-500 hover:text-stone-300">Open →</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <LeadModal lead={active} onClose={() => setActive(null)} onSave={handleSave} />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
