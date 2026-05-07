"use client";

import { useState, useMemo, useCallback, memo } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { ProjectModal } from "@/components/forms";
import { fmt, daysOverdue } from "@/lib/format";
import { Briefcase, Plus, Trash2, X, RefreshCw } from "lucide-react";

function ReclassifyModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { reps, regions, reclassifyProjects } = useData() as any;
  const [repId, setRepId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [saving, setSaving] = useState(false);

  const handleApply = async () => {
    if (!repId && !regionId) return;
    setSaving(true);
    try {
      const repVal = repId === "null" ? null : repId || undefined;
      const regVal = regionId === "null" ? null : regionId || undefined;
      await reclassifyProjects(ids, repVal, regVal);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h2 className="text-base font-semibold text-stone-900 mb-1">Reclassify projects</h2>
        <p className="text-sm text-stone-500 mb-4">Make changes to all <strong>{ids.length}</strong> selected project{ids.length > 1 ? "s" : ""}.</p>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Change Rep to</label>
            <select value={repId} onChange={e => setRepId(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 bg-white focus:ring-2 focus:ring-stone-900 focus:outline-none">
              <option value="">— No change —</option>
              <option value="null">Unassign rep</option>
              {reps.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Change Region to</label>
            <select value={regionId} onChange={e => setRegionId(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 bg-white focus:ring-2 focus:ring-stone-900 focus:outline-none">
              <option value="">— No change —</option>
              <option value="null">Unassign region</option>
              {regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button onClick={handleApply} disabled={saving || (!repId && !regionId)}>
            {saving ? "Applying…" : "Apply"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const ProjectRow = memo(function ProjectRow({ p, isSelected, onToggle, statusColor }: { p: any; isSelected: boolean; onToggle: (id: string) => void; statusColor: (s: string) => string }) {
  return (
    <tr className={`border-b border-stone-100 hover:bg-stone-50 ${isSelected ? "bg-blue-50/50" : ""}`}>
      <td className="px-4 py-3 w-10">
        <input type="checkbox" checked={isSelected} onChange={() => onToggle(p.id)} className="rounded border-stone-300 cursor-pointer" />
      </td>
      <td className="px-4 py-3">
        <div className="font-medium text-stone-900">{p.name}</div>
        <div className="text-[11px] text-stone-500 font-mono mt-0.5">{p.code}</div>
      </td>
      <td className="px-4 py-3">
        {p.customer && <Link href={`/customers/${p.customer.id}`} className="text-stone-700 hover:text-stone-900 hover:underline">{p.customer.name}</Link>}
      </td>
      <td className="px-4 py-3">
        {p.repName ? <span className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium">{p.repName}</span> : <span className="text-stone-400 text-[11px]">—</span>}
      </td>
      <td className="px-4 py-3">
        {p.regionName ? <span className="text-[11px] bg-stone-100 text-stone-600 px-2 py-0.5 rounded font-medium">{p.regionName}</span> : <span className="text-stone-400 text-[11px]">—</span>}
      </td>
      <td className="px-4 py-3"><Badge variant={statusColor(p.status) as any} size="sm">{p.status}</Badge></td>
      <td className="px-4 py-3 text-right tabular-nums">{p.openCount}</td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmt.money(p.outstanding, p.customer?.currency)}</td>
      <td className={`px-4 py-3 text-right font-semibold tabular-nums ${p.overdue > 0 ? "text-rose-600" : "text-stone-500"}`}>{fmt.money(p.overdue, p.customer?.currency)}</td>
    </tr>
  );
});

export default function ProjectsPage() {
  const { projects, customers, invoices, reps, regions, bulkDeleteProjects } = useData() as any;
  const [showCreate, setShowCreate] = useState(false);
  const [repFilter, setRepFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showReclassify, setShowReclassify] = useState(false);

  const enriched = useMemo(() => projects.map((p: any) => {
    const customer = customers.find((c: any) => c.id === p.customerId);
    const projInvoices = invoices.filter((i: any) => i.projectId === p.id);
    const open = projInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off");
    const outstanding = open.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
    const overdue = open.filter((i: any) => daysOverdue(i.dueDate) > 0).reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
    const rep = reps.find((r: any) => r.id === p.repId);
    const region = regions.find((r: any) => r.id === p.regionId);
    return { ...p, customer, openCount: open.length, outstanding, overdue, repName: rep?.name, regionName: region?.name };
  }), [projects, customers, invoices, reps, regions]);

  const filtered = useMemo(() => {
    let res = enriched;
    if (repFilter) res = res.filter((p: any) => p.repId === repFilter);
    if (regionFilter) res = res.filter((p: any) => p.regionId === regionFilter);
    return res.sort((a: any, b: any) => b.outstanding - a.outstanding);
  }, [enriched, repFilter, regionFilter]);

  const allSelected = filtered.length > 0 && filtered.every((p: any) => selected.has(p.id));
  const toggleAll = () => allSelected ? setSelected(new Set()) : setSelected(new Set(filtered.map((p: any) => p.id)));
  const toggleOne = useCallback((id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  }), []);

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      await bulkDeleteProjects(Array.from(selected));
      setSelected(new Set());
      setConfirmDelete(false);
    } finally { setDeleting(false); }
  };

  const statusColor = useCallback((s: string) => ({ "Active": "blue", "In Progress": "purple", "Completed": "green", "Pending": "yellow", "On Hold": "orange", "Cancelled": "neutral" }[s] || "neutral"), []);

  return (
    <div className="p-6 max-w-[1300px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Projects</h1>
          <p className="text-sm text-stone-500 mt-1">{filtered.length} projects</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}
            className="h-9 px-3 pr-8 text-sm rounded-md ring-1 ring-stone-200 bg-white appearance-none"
            style={{backgroundImage:`url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 0.5rem center",backgroundSize:"12px"}}>
            <option value="">All reps</option>
            {reps.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}
            className="h-9 px-3 pr-8 text-sm rounded-md ring-1 ring-stone-200 bg-white appearance-none"
            style={{backgroundImage:`url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 0.5rem center",backgroundSize:"12px"}}>
            <option value="">All regions</option>
            {regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {(repFilter || regionFilter) && (
            <Button variant="ghost" size="sm" onClick={() => { setRepFilter(""); setRegionFilter(""); }}>Clear</Button>
          )}
          <Button icon={Plus} onClick={() => setShowCreate(true)}>New project</Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 px-4 py-2.5 bg-stone-900 text-white rounded-lg">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex-1" />
          <button onClick={() => setSelected(new Set())} className="text-stone-400 hover:text-white p-1 rounded"><X size={14} /></button>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => setShowReclassify(true)}>Reclassify</Button>
          {!confirmDelete ? (
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmDelete(true)}>Delete {selected.size}</Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-amber-300">Cannot be undone. Sure?</span>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleBulkDelete} disabled={deleting}>{deleting ? "Deleting…" : "Yes, delete"}</Button>
            </div>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={Briefcase} title="No projects found"
            description={projects.length === 0 ? "Projects group invoices for a customer engagement." : "Try adjusting your filters."}
            action={projects.length === 0 ? <Button icon={Plus} onClick={() => setShowCreate(true)}>New project</Button> : undefined} />
        </Card>
      ) : (
        <Card padding="none">
          <div className="px-4 py-2.5 border-b border-stone-200 flex items-center gap-2">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-stone-300 cursor-pointer" />
            <span className="text-[11px] text-stone-500">Select all</span>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
              <th className="w-10 px-4 py-2.5"></th>
              <th className="text-left font-semibold px-4 py-2.5">Project</th>
              <th className="text-left font-semibold px-4 py-2.5">Customer</th>
              <th className="text-left font-semibold px-4 py-2.5">Rep</th>
              <th className="text-left font-semibold px-4 py-2.5">Region</th>
              <th className="text-left font-semibold px-4 py-2.5">Status</th>
              <th className="text-right font-semibold px-4 py-2.5">Open inv.</th>
              <th className="text-right font-semibold px-4 py-2.5">Outstanding</th>
              <th className="text-right font-semibold px-4 py-2.5">Overdue</th>
            </tr></thead>
            <tbody>
              {filtered.map((p: any) => (
                <ProjectRow key={p.id} p={p} isSelected={selected.has(p.id)} onToggle={toggleOne} statusColor={statusColor} />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showCreate && <ProjectModal onClose={() => setShowCreate(false)} />}
      {showReclassify && (
        <ReclassifyModal
          ids={Array.from(selected)}
          onClose={() => { setShowReclassify(false); setSelected(new Set()); }}
        />
      )}
    </div>
  );
}
