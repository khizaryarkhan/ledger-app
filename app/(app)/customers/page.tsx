"use client";

import { useState, useMemo, useCallback, memo, useEffect } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Badge, Input, Select, Button, EmptyState } from "@/components/ui";
import { CustomerModal } from "@/components/forms";
import { fmt, daysOverdue } from "@/lib/format";
import { Search, Users, Plus, Trash2, X, RefreshCw } from "lucide-react";

function ReclassifyModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { reps, regions, reclassifyCustomers } = useData() as any;
  const [repId, setRepId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [saving, setSaving] = useState(false);

  const handleApply = async () => {
    if (!repId && !regionId) return;
    setSaving(true);
    try {
      const repVal = repId === "null" ? null : repId || undefined;
      const regVal = regionId === "null" ? null : regionId || undefined;
      await reclassifyCustomers(ids, repVal, regVal);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h2 className="text-base font-semibold text-stone-900 mb-1">Reclassify customers</h2>
        <p className="text-sm text-stone-500 mb-4">Make changes to all <strong>{ids.length}</strong> selected customer{ids.length > 1 ? "s" : ""}.</p>

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

const CustomerCard = memo(function CustomerCard({ c, isSelected, onToggle }: { c: any; isSelected: boolean; onToggle: (id: string) => void }) {
  return (
    <div className={`relative rounded-lg ring-1 transition-colors ${isSelected ? "ring-stone-900 ring-2" : "ring-stone-200 hover:ring-stone-300"}`}>
      <div className="absolute top-3 left-3 z-10">
        <input type="checkbox" checked={isSelected} onChange={() => onToggle(c.id)}
          className="rounded border-stone-300 cursor-pointer" onClick={(e) => e.stopPropagation()} />
      </div>
      <Link href={`/customers/${c.id}`}>
        <Card className="cursor-pointer h-full ring-0 hover:ring-0">
          <div className="flex items-start gap-3 mb-3 pl-5">
            <div className="w-10 h-10 rounded-md bg-gradient-to-br from-stone-100 to-stone-200 flex items-center justify-center text-stone-700 text-sm font-semibold flex-shrink-0">
              {c.name.split(" ").slice(0, 2).map((w: string) => w[0]).join("")}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-stone-900 truncate">{c.name}</div>
              <div className="text-[11px] text-stone-500 mt-0.5">{c.code} · {c.country || "—"}</div>
              {(c.repName || c.regionName) && (
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {c.repName && <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium">{c.repName}</span>}
                  {c.regionName && <span className="text-[10px] bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded font-medium">{c.regionName}</span>}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1 items-end">
              {c.riskRating === "High" && <Badge variant="red" size="sm">High</Badge>}
              {c.riskRating === "Medium" && <Badge variant="yellow" size="sm">Med</Badge>}
              {c.status !== "Active" && <Badge variant="orange" size="sm">{c.status}</Badge>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-stone-100">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Outstanding</div>
              <div className="text-sm font-semibold text-stone-900 tabular-nums mt-0.5">{fmt.money(c.outstanding, c.currency)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Overdue</div>
              <div className={`text-sm font-semibold tabular-nums mt-0.5 ${c.overdue > 0 ? "text-rose-600" : "text-stone-900"}`}>{fmt.money(c.overdue, c.currency)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Open inv.</div>
              <div className="text-sm font-semibold text-stone-900 tabular-nums mt-0.5">{c.openCount}</div>
            </div>
          </div>
        </Card>
      </Link>
    </div>
  );
});

export default function CustomersPage() {
  const { customers, invoices, reps, regions, bulkDeleteCustomers } = useData() as any;
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [repFilter, setRepFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showReclassify, setShowReclassify] = useState(false);

  const enriched = useMemo(() => {
    return customers.map((c: any) => {
      const custInvoices = invoices.filter((i: any) => i.customerId === c.id);
      const open = custInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off");
      const outstanding = open.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
      const overdue = open.filter((i: any) => daysOverdue(i.dueDate) > 0).reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
      const rep = reps.find((r: any) => r.id === c.repId);
      const region = regions.find((r: any) => r.id === c.regionId);
      return { ...c, outstanding, overdue, openCount: open.length, repName: rep?.name, regionName: region?.name };
    });
  }, [customers, invoices, reps, regions]);

  const filtered = useMemo(() => {
    let res = enriched;
    if (search) {
      const s = search.toLowerCase();
      res = res.filter((c: any) => c.name.toLowerCase().includes(s) || c.code.toLowerCase().includes(s) || (c.email || "").toLowerCase().includes(s));
    }
    if (riskFilter) res = res.filter((c: any) => c.riskRating === riskFilter);
    if (statusFilter) res = res.filter((c: any) => c.status === statusFilter);
    if (repFilter) res = res.filter((c: any) => c.repId === repFilter);
    if (regionFilter) res = res.filter((c: any) => c.regionId === regionFilter);
    return res.sort((a: any, b: any) => b.outstanding - a.outstanding);
  }, [enriched, search, riskFilter, statusFilter, repFilter, regionFilter]);

  const toggleOne = useCallback((id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  }), []);

  const PAGE_SIZE = 48;
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [search, riskFilter, statusFilter, repFilter, regionFilter]);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const visible = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  const allSelected = filtered.length > 0 && filtered.every((c: any) => selected.has(c.id));
  const toggleAll = () => allSelected ? setSelected(new Set()) : setSelected(new Set(filtered.map((c: any) => c.id)));

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      await bulkDeleteCustomers(Array.from(selected));
      setSelected(new Set());
      setConfirmDelete(false);
    } finally { setDeleting(false); }
  };

  const hasFilters = search || riskFilter || statusFilter || repFilter || regionFilter;

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Customers</h1>
          <p className="text-sm text-stone-500 mt-1">{filtered.length} customers</p>
        </div>
        <Button icon={Plus} onClick={() => setShowCreate(true)}>New customer</Button>
      </div>

      <div className={selected.size > 0 ? "mb-3" : "h-0 overflow-hidden"}>
        <div className="flex items-center gap-3 px-4 py-2.5 bg-stone-900 text-white rounded-lg">
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
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Input value={search} onChange={(e: any) => setSearch(e.target.value)} placeholder="Search by name, code or email..." icon={Search} className="w-72" />
        <Select value={riskFilter} onChange={(e: any) => setRiskFilter(e.target.value)} placeholder="All risk levels" options={["Low", "Medium", "High"]} />
        <Select value={statusFilter} onChange={(e: any) => setStatusFilter(e.target.value)} placeholder="All statuses" options={["Active", "On Hold", "Inactive"]} />
        <select value={repFilter} onChange={(e: any) => setRepFilter(e.target.value)}
          className="h-9 px-3 pr-8 text-sm rounded-md ring-1 ring-stone-200 bg-white appearance-none"
          style={{backgroundImage:`url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 0.5rem center",backgroundSize:"12px"}}>
          <option value="">All reps</option>
          {reps.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={regionFilter} onChange={(e: any) => setRegionFilter(e.target.value)}
          className="h-9 px-3 pr-8 text-sm rounded-md ring-1 ring-stone-200 bg-white appearance-none"
          style={{backgroundImage:`url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 0.5rem center",backgroundSize:"12px"}}>
          <option value="">All regions</option>
          {regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {hasFilters && <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setRiskFilter(""); setStatusFilter(""); setRepFilter(""); setRegionFilter(""); }}>Clear</Button>}
        {filtered.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-stone-600 ml-2 cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-stone-300" />
            Select all
          </label>
        )}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title="No customers found"
            description={customers.length === 0 ? "Create your first customer or sync from QuickBooks." : "Try adjusting your filters."}
            action={customers.length === 0 ? <Button icon={Plus} onClick={() => setShowCreate(true)}>New customer</Button> : undefined} />
        </Card>
      ) : (
        <>
        <div className="grid grid-cols-3 gap-3">
          {visible.map((c: any) => (
            <CustomerCard key={c.id} c={c} isSelected={selected.has(c.id)} onToggle={toggleOne} />
          ))}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-1 mt-4">
            <span className="text-xs text-stone-500">Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="px-3 py-1.5 text-xs rounded-md ring-1 ring-stone-200 disabled:opacity-40 hover:bg-stone-50">Prev</button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button key={i} onClick={() => setPage(i)}
                  className={`px-3 py-1.5 text-xs rounded-md ring-1 ${page === i ? "bg-stone-900 text-white ring-stone-900" : "ring-stone-200 hover:bg-stone-50"}`}>{i + 1}</button>
              ))}
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                className="px-3 py-1.5 text-xs rounded-md ring-1 ring-stone-200 disabled:opacity-40 hover:bg-stone-50">Next</button>
            </div>
          </div>
        )}
        </>
      )}

      {showCreate && <CustomerModal onClose={() => setShowCreate(false)} />}
      {showReclassify && (
        <ReclassifyModal
          ids={Array.from(selected)}
          onClose={() => { setShowReclassify(false); setSelected(new Set()); }}
        />
      )}
    </div>
  );
}
