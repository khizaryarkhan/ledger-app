"use client";

import { useState } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { ProjectModal } from "@/components/forms";
import { fmt, daysOverdue } from "@/lib/format";
import { Briefcase, Plus, Trash2, X } from "lucide-react";
import { getProjectRegionId, getProjectRegion, REGIONS } from "@/lib/regions";

export default function ProjectsPage() {
  const { projects, customers, invoices, bulkDeleteProjects } = useData() as any;
  const [showCreate, setShowCreate] = useState(false);
  const [regionFilter, setRegionFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const enriched = projects.map((p: any) => {
    const customer = customers.find((c: any) => c.id === p.customerId);
    const projInvoices = invoices.filter((i: any) => i.projectId === p.id);
    const open = projInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off");
    const outstanding = open.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
    const overdue = open.filter((i: any) => daysOverdue(i.dueDate) > 0).reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
    return { ...p, customer, openCount: open.length, outstanding, overdue, region: getProjectRegion(p) };
  }).filter((p: any) => !regionFilter || getProjectRegionId(p) === regionFilter).sort((a: any, b: any) => b.outstanding - a.outstanding);

  const allSelected = enriched.length > 0 && enriched.every((p: any) => selected.has(p.id));
  const toggleAll = () => allSelected ? setSelected(new Set()) : setSelected(new Set(enriched.map((p: any) => p.id)));
  const toggleOne = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      await bulkDeleteProjects(Array.from(selected));
      setSelected(new Set());
      setConfirmDelete(false);
    } finally { setDeleting(false); }
  };

  const statusColor = (s: string) => ({ "Active": "blue", "In Progress": "purple", "Completed": "green", "Pending": "yellow", "On Hold": "orange", "Cancelled": "neutral" }[s] || "neutral");

  return (
    <div className="p-6 max-w-[1300px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Projects</h1>
          <p className="text-sm text-stone-500 mt-1">{enriched.length} projects</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={regionFilter} onChange={(e: any) => setRegionFilter(e.target.value)} className="h-9 px-3 pr-8 text-sm rounded-md ring-1 ring-stone-200 bg-white"><option value="">All regions</option><option value="dublin">Dublin</option><option value="cork">Cork</option><option value="galway">Galway</option><option value="limerick">Limerick</option><option value="london">London</option></select>
          <Button icon={Plus} onClick={() => setShowCreate(true)}>New project</Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 px-4 py-2.5 bg-stone-900 text-white rounded-lg">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex-1" />
          <button onClick={() => setSelected(new Set())} className="text-stone-400 hover:text-white p-1 rounded"><X size={14} /></button>
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

      {enriched.length === 0 ? (
        <Card>
          <EmptyState icon={Briefcase} title="No projects yet" description="Projects group invoices for a customer engagement."
            action={<Button icon={Plus} onClick={() => setShowCreate(true)}>New project</Button>} />
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
              <th className="text-left font-semibold px-4 py-2.5">Region</th>
              <th className="text-left font-semibold px-4 py-2.5">Status</th>
              <th className="text-right font-semibold px-4 py-2.5">Open inv.</th>
              <th className="text-right font-semibold px-4 py-2.5">Outstanding</th>
              <th className="text-right font-semibold px-4 py-2.5">Overdue</th>
            </tr></thead>
            <tbody>
              {enriched.map((p: any) => (
                <tr key={p.id} className={`border-b border-stone-100 hover:bg-stone-50 ${selected.has(p.id) ? "bg-blue-50/50" : ""}`}>
                  <td className="px-4 py-3 w-10">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} className="rounded border-stone-300 cursor-pointer" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-stone-900">{p.name}</div>
                    <div className="text-[11px] text-stone-500 font-mono mt-0.5">{p.code}</div>
                  </td>
                  <td className="px-4 py-3">
                    {p.customer && <Link href={`/customers/${p.customer.id}`} className="text-stone-700 hover:text-stone-900 hover:underline">{p.customer.name}</Link>}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-stone-600">{p.region}</td>
                  <td className="px-4 py-3"><Badge variant={statusColor(p.status) as any} size="sm">{p.status}</Badge></td>
                  <td className="px-4 py-3 text-right tabular-nums">{p.openCount}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmt.money(p.outstanding, p.customer?.currency)}</td>
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${p.overdue > 0 ? "text-rose-600" : "text-stone-500"}`}>{fmt.money(p.overdue, p.customer?.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showCreate && <ProjectModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
