"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Badge, Input, Select, Button, EmptyState } from "@/components/ui";
import { CustomerModal } from "@/components/forms";
import { fmt, daysOverdue } from "@/lib/format";
import { Search, Users, Plus, Trash2, X } from "lucide-react";
import { getRegionId } from "@/lib/regions";

export default function CustomersPage() {
  const { customers, invoices, bulkDeleteCustomers } = useData() as any;
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const enriched = useMemo(() => {
    return customers.map((c: any) => {
      const custInvoices = invoices.filter((i: any) => i.customerId === c.id);
      const open = custInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off");
      const outstanding = open.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
      const overdue = open.filter((i: any) => daysOverdue(i.dueDate) > 0).reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
      return { ...c, outstanding, overdue, openCount: open.length };
    });
  }, [customers, invoices]);

  const filtered = useMemo(() => {
    let res = enriched;
    if (search) {
      const s = search.toLowerCase();
      res = res.filter((c: any) => c.name.toLowerCase().includes(s) || c.code.toLowerCase().includes(s) || (c.email || "").toLowerCase().includes(s));
    }
    if (riskFilter) res = res.filter((c: any) => c.riskRating === riskFilter);
    if (statusFilter) res = res.filter((c: any) => c.status === statusFilter);
    if (regionFilter) {
      // Keep customers that have at least one project/invoice in this region
      const { invoices: allInvoices, projects: allProjects } = { invoices: enriched, projects: [] };
      res = res.filter((c: any) => {
        // Check if customer code itself matches region
        if (getRegionId(c.code) === regionFilter) return true;
        return false;
      });
    }
    return res.sort((a: any, b: any) => b.outstanding - a.outstanding);
  }, [enriched, search, riskFilter, statusFilter]);

  const toggleOne = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

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

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Customers</h1>
          <p className="text-sm text-stone-500 mt-1">{filtered.length} customers</p>
        </div>
        <Button icon={Plus} onClick={() => setShowCreate(true)}>New customer</Button>
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

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Input value={search} onChange={(e: any) => setSearch(e.target.value)} placeholder="Search by name, code or email..." icon={Search} className="w-72" />
        <Select value={riskFilter} onChange={(e: any) => setRiskFilter(e.target.value)} placeholder="All risk levels" options={["Low", "Medium", "High"]} />
        <Select value={statusFilter} onChange={(e: any) => setStatusFilter(e.target.value)} placeholder="All statuses" options={["Active", "On Hold", "Inactive"]} />
        <select value={regionFilter} onChange={(e: any) => setRegionFilter(e.target.value)} className="h-9 px-3 pr-8 text-sm rounded-md ring-1 ring-stone-200 bg-white"><option value="">All regions</option><option value="dublin">Dublin</option><option value="cork">Cork</option><option value="galway">Galway</option><option value="limerick">Limerick</option><option value="london">London</option></select>
        {(search || riskFilter || statusFilter || regionFilter) && <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setRiskFilter(""); setStatusFilter(""); setRegionFilter(""); }}>Clear</Button>}
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
        <div className="grid grid-cols-3 gap-3">
          {filtered.map((c: any) => (
            <div key={c.id} className={`relative rounded-lg ring-1 transition-all ${selected.has(c.id) ? "ring-stone-900 ring-2" : "ring-stone-200 hover:ring-stone-300"}`}>
              <div className="absolute top-3 left-3 z-10">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)}
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
                      {c.email && <div className="text-[11px] text-stone-400 truncate mt-0.5">{c.email}</div>}
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
          ))}
        </div>
      )}

      {showCreate && <CustomerModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
