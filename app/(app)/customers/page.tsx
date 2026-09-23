"use client";

import { useState, useMemo, useCallback, memo, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useData } from "@/components/data-provider";
import { Card, Badge, Button } from "@/components/ui";
import { CustomerModal } from "@/components/forms";
import { fmt, daysOverdue } from "@/lib/format";
import { Search, Plus, Trash2, X, RefreshCw, LayoutGrid, List } from "lucide-react";
import { SelectField, control, Drawer } from "@/components/form-kit";
import {
  useListView, ListPage, ListPageHeader, ListDivider, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  listTable, listRow, listCheckCell, listCheckbox, listMoneyCell, listNumCell, type ListColumn,
} from "@/components/list-view";
import { InlineAssign, type AssignGroup } from "@/components/inline-assign";


function ReclassifyModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { regions, countries, reclassifyCustomers } = useData() as any;
  const [repId, setRepId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [countryId, setCountryId] = useState("");
  const [saving, setSaving] = useState(false);

  // Always fetch fresh reps when the modal opens so newly-created users appear immediately
  const [freshReps, setFreshReps] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/org/assignable-reps").then(r => r.json()).then(setFreshReps).catch(() => {});
  }, []);

  const handleApply = async () => {
    if (!repId && !regionId && !countryId) return;
    setSaving(true);
    try {
      const repVal = repId === "null" ? null : repId || undefined;
      const regVal = regionId === "null" ? null : regionId || undefined;
      const ctyVal = countryId === "null" ? null : countryId || undefined;
      await reclassifyCustomers(ids, repVal, regVal, ctyVal);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Drawer
      onClose={onClose}
      title="Reclassify customers"
      subtitle={<>Make changes to all <strong className="text-stone-300">{ids.length}</strong> selected customer{ids.length > 1 ? "s" : ""}.</>}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button onClick={handleApply} disabled={saving || (!repId && !regionId && !countryId)}>
            {saving ? "Applying…" : "Apply"}
          </Button>
        </div>
      }
    >
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider block mb-1">Change Rep to</label>
            <select value={repId} onChange={e => setRepId(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800 text-stone-300 focus:border-emerald-500 focus:outline-none">
              <option value="">— No change —</option>
              <option value="null">Unassign rep</option>
              {freshReps.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider block mb-1">Change Region to</label>
            <select value={regionId} onChange={e => setRegionId(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800 text-stone-300 focus:border-emerald-500 focus:outline-none">
              <option value="">— No change —</option>
              <option value="null">Unassign region</option>
              {regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider block mb-1">Change Country to</label>
            <select value={countryId} onChange={e => setCountryId(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800 text-stone-300 focus:border-emerald-500 focus:outline-none">
              <option value="">— No change —</option>
              <option value="null">Unassign country</option>
              {(countries ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

    </Drawer>
  );
}

const CustomerCard = memo(function CustomerCard({ c, isSelected, onToggle, repGroups, regionGroups, onAssign, busy }: { c: any; isSelected: boolean; onToggle: (id: string) => void; repGroups: AssignGroup[]; regionGroups: AssignGroup[]; onAssign: (id: string, field: "rep" | "region", value: string | null) => void; busy: boolean }) {
  return (
    <div className={`relative rounded-lg ring-1 transition-colors ${isSelected ? "ring-emerald-500 ring-2" : "ring-stone-700 hover:ring-stone-600"}`}>
      <div className="absolute top-3 left-3 z-10">
        <input type="checkbox" checked={isSelected} onChange={() => onToggle(c.id)}
          className="rounded border-stone-600 cursor-pointer" onClick={(e) => e.stopPropagation()} />
      </div>
      <Link href={`/customers/${c.id}`}>
        <Card className="cursor-pointer h-full ring-0 hover:ring-0">
          <div className="flex items-start gap-3 mb-3 pl-5">
            <div className="w-10 h-10 rounded-md bg-gradient-to-br from-stone-700 to-stone-800 flex items-center justify-center text-stone-300 text-sm font-semibold flex-shrink-0">
              {c.name.split(" ").slice(0, 2).map((w: string) => w[0]).join("")}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate">{c.name}</div>
              <div className="text-[11px] text-stone-500 mt-0.5">
                {c.code && !c.code.startsWith("QBO-") ? `${c.code} · ` : ""}{c.countryName || "—"}
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap"
                onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
                <InlineAssign value={c.repId ?? null} tone="blue" title="Assign rep / ED-RM" busy={busy}
                  groups={repGroups} onChange={v => onAssign(c.id, "rep", v)} />
                <InlineAssign value={c.regionId ?? null} tone="stone" title="Assign region" busy={busy}
                  groups={regionGroups} onChange={v => onAssign(c.id, "region", v)} />
              </div>
            </div>
            <div className="flex flex-col gap-1 items-end">
              {c.riskRating === "High" && <Badge variant="red" size="sm">High</Badge>}
              {c.riskRating === "Medium" && <Badge variant="yellow" size="sm">Med</Badge>}
              {c.status !== "Active" && <Badge variant="orange" size="sm">{c.status}</Badge>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-stone-800">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Outstanding</div>
              <div className="text-sm font-semibold text-white tabular-nums mt-0.5">{fmt.money(c.outstanding, c.invoiceCurrency)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Overdue</div>
              <div className={`text-sm font-semibold tabular-nums mt-0.5 ${c.overdue > 0 ? "text-rose-400" : "text-white"}`}>{fmt.money(c.overdue, c.invoiceCurrency)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Open inv.</div>
              <div className="text-sm font-semibold text-white tabular-nums mt-0.5">{c.openCount}</div>
            </div>
          </div>
        </Card>
      </Link>
    </div>
  );
});

export default function CustomersPage() {
  const { customers, invoices, reps, regions, countries, bulkDeleteCustomers, reclassifyCustomers } = useData() as any;

  // Assignable people for inline Rep editing (reps/EDs + admins, incl. multi-org).
  const [assignableReps, setAssignableReps] = useState<{ id: string; name: string; tier: string }[]>([]);
  useEffect(() => {
    fetch("/api/org/assignable-reps").then(r => r.json()).then(d => Array.isArray(d) && setAssignableReps(d)).catch(() => {});
  }, []);
  const repGroups: AssignGroup[] = useMemo(() => [
    { label: "Rep / PM", items: assignableReps.filter(r => r.tier !== "ed" && r.tier !== "rd") },
    { label: "ED / RM", items: assignableReps.filter(r => r.tier === "ed" || r.tier === "rd") },
  ], [assignableReps]);
  const regionGroups: AssignGroup[] = useMemo(() => [{ label: "", items: regions }], [regions]);
  const repNameById = useMemo(() => {
    const m = new Map<string, string>();
    reps.forEach((r: any) => m.set(r.id, r.name));
    assignableReps.forEach(r => m.set(r.id, r.name));
    return m;
  }, [reps, assignableReps]);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const onAssign = useCallback(async (id: string, field: "rep" | "region", value: string | null) => {
    setAssigningId(id);
    try {
      if (field === "rep") await reclassifyCustomers([id], value);
      else await reclassifyCustomers([id], undefined, value);
    } finally { setAssigningId(null); }
  }, [reclassifyCustomers]);

  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [repFilter, setRepFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showReclassify, setShowReclassify] = useState(false);

  // "Add customer" from the Create menu (any module) lands here with ?new=1
  // and opens the same modal the inline "Add" button uses — one real add
  // flow, not a second one on a thinner accounting-only screen.
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setShowCreate(true);
      router.replace("/customers");
    }
  }, [searchParams, router]);

  const enriched = useMemo(() => {
    return customers.map((c: any) => {
      const custInvoices = invoices.filter((i: any) => i.customerId === c.id);
      const open = custInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" && i.txnType !== "CreditMemo");
      const outstanding = open.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
      const overdue = open.filter((i: any) => daysOverdue(i.dueDate) > 0).reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
      const region = regions.find((r: any) => r.id === c.regionId);
      const country = (countries ?? []).find((x: any) => x.id === c.countryId);
      // Compute status from outstanding — always real-time, no sync delay needed.
      // "On Hold" is a manual override and is preserved regardless of AR balance.
      const effectiveStatus = c.status === "On Hold" ? "On Hold" : outstanding > 0 ? "Active" : "Inactive";
      const invoiceCurrency = open[0]?.currency ?? "?";
      return { ...c, outstanding, overdue, openCount: open.length, repName: c.repId ? repNameById.get(c.repId) : undefined, regionName: region?.name, countryName: country?.name, effectiveStatus, invoiceCurrency };
    });
  }, [customers, invoices, regions, repNameById]);

  const filtered = useMemo(() => {
    let res = enriched;
    if (search) {
      const s = search.toLowerCase();
      res = res.filter((c: any) => c.name.toLowerCase().includes(s) || c.code.toLowerCase().includes(s) || (c.email || "").toLowerCase().includes(s));
    }
    if (riskFilter) res = res.filter((c: any) => c.riskRating === riskFilter);
    if (statusFilter) res = res.filter((c: any) => c.effectiveStatus === statusFilter);
    if (repFilter) res = res.filter((c: any) => c.repId === repFilter);
    if (regionFilter) res = res.filter((c: any) => c.regionId === regionFilter);
    return res;
  }, [enriched, search, riskFilter, statusFilter, repFilter, regionFilter]);

  const [viewMode, setViewMode] = useState<"grid" | "list">("list");

  // Column definitions — sort + funnel filter per column, board-style.
  const CUST_COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "name",        label: "Customer", sort: r => r.name, filter: { kind: "text", value: r => r.name } },
    { key: "code",        label: "Code",     sort: r => (r.code?.startsWith("QBO-") ? null : r.code), filter: { kind: "text", value: r => (r.code?.startsWith("QBO-") ? null : r.code) } },
    { key: "country",     label: "Country",  sort: r => r.countryName, filter: { kind: "multi", value: r => r.countryName } },
    { key: "rep",         label: "Rep",      sort: r => r.repName, filter: { kind: "multi", value: r => r.repName } },
    { key: "region",      label: "Region",   sort: r => r.regionName, filter: { kind: "multi", value: r => r.regionName } },
    { key: "risk",        label: "Risk",     sort: r => r.riskRating, filter: { kind: "multi", value: r => r.riskRating } },
    // Filters on the status the row SHOWS (effectiveStatus). It used to filter
    // on the stored `status`, so picking "Inactive" could hide rows labelled
    // Inactive and keep rows labelled Active.
    { key: "status",      label: "Status",   sort: r => r.effectiveStatus, filter: { kind: "multi", value: r => r.effectiveStatus } },
    { key: "openCount",   label: "Open inv.", sort: r => r.openCount, descFirst: true, align: "right", filter: { kind: "range", value: r => r.openCount }, sum: r => r.openCount },
    { key: "overdue",     label: "Overdue",  sort: r => r.overdue, descFirst: true, align: "right",
      filter: { kind: "range", value: r => r.overdue }, money: r => ({ amount: r.overdue, currency: r.invoiceCurrency }) },
    { key: "outstanding", label: "Outstanding", sort: r => r.outstanding, descFirst: true, align: "right",
      filter: { kind: "range", value: r => r.outstanding }, money: r => ({ amount: r.outstanding, currency: r.invoiceCurrency }) },
  ], []);
  const lv = useListView(filtered, CUST_COLS, { storageKey: "customers", defaultSort: "outstanding", defaultDir: "desc", summary: "outstanding" });

  // Batch actions must never silently operate on rows the user can no longer
  // see — prune the selection when filters hide them (board rule).
  useEffect(() => {
    const visibleIds = new Set(lv.rows.map((c: any) => c.id));
    setSelected(prev => [...prev].some(id => !visibleIds.has(id)) ? new Set([...prev].filter(id => visibleIds.has(id))) : prev);
  }, [lv.rows]);

  const toggleOne = useCallback((id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  }), []);

  // Card view pages through the same filtered + sorted rows the list shows.
  const PAGE_SIZE = 48;
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [search, riskFilter, statusFilter, repFilter, regionFilter, lv.filters]);
  const totalPages = Math.ceil(lv.rows.length / PAGE_SIZE);
  const visible = useMemo(() => lv.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [lv.rows, page]);

  const allSelected = lv.rows.length > 0 && lv.rows.every((c: any) => selected.has(c.id));
  const toggleAll = () => allSelected ? setSelected(new Set()) : setSelected(new Set(lv.rows.map((c: any) => c.id)));

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      await bulkDeleteCustomers(Array.from(selected));
      setSelected(new Set());
      setConfirmDelete(false);
    } finally { setDeleting(false); }
  };

  const hasFilters = !!(search || riskFilter || statusFilter || repFilter || regionFilter);
  const td = "px-2 py-2";
  const viewBtn = (on: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${on ? "bg-emerald-500 text-white shadow-sm" : "text-stone-400 hover:text-stone-200"}`;

  return (
    <ListPage>
      <ListPageHeader title="Customers" subtitle={<>{customers.length} customer{customers.length !== 1 ? "s" : ""}</>}>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code or email…"
            className={`${control} h-8 w-56 pl-7 pr-2 text-xs`} />
        </div>
        {/* Header filters stay because the card view has no column headers
            to put a funnel on; the list view adds per-column filters on top. */}
        <SelectField value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status" className="w-auto h-8 text-xs">
          <option value="">All statuses</option>
          {["Active", "On Hold", "Inactive"].map(s => <option key={s} value={s}>{s}</option>)}
        </SelectField>
        <SelectField value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} aria-label="Filter by risk" className="w-auto h-8 text-xs">
          <option value="">All risk levels</option>
          {["Low", "Medium", "High"].map(s => <option key={s} value={s}>{s}</option>)}
        </SelectField>
        {reps.length > 0 && (
          <SelectField value={repFilter} onChange={(e) => setRepFilter(e.target.value)} aria-label="Filter by rep" className="w-auto h-8 text-xs">
            <option value="">All reps</option>
            {reps.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </SelectField>
        )}
        <SelectField value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} aria-label="Filter by region" className="w-auto h-8 text-xs">
          <option value="">All regions</option>
          {regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </SelectField>
        {hasFilters && (
          <button onClick={() => { setSearch(""); setRiskFilter(""); setStatusFilter(""); setRepFilter(""); setRegionFilter(""); }}
            className="text-[11px] text-stone-500 hover:text-rose-400 font-medium px-1">Clear</button>
        )}
        <ListDivider />
        <div className="flex bg-stone-800 rounded-md p-0.5 border border-stone-700">
          <button onClick={() => setViewMode("grid")} className={viewBtn(viewMode === "grid")}><LayoutGrid size={12} /> Cards</button>
          <button onClick={() => setViewMode("list")} className={viewBtn(viewMode === "list")}><List size={12} /> List</button>
        </div>
        <Button icon={Plus} size="sm" onClick={() => setShowCreate(true)}>New customer</Button>
      </ListPageHeader>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-stone-900 text-white border-b border-stone-800 flex-wrap shrink-0">
          <span className="text-[13px] font-medium">{selected.size} selected</span>
          <div className="flex-1" />
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
          <button onClick={() => setSelected(new Set())} className="text-stone-400 hover:text-white p-1" aria-label="Clear selection"><X size={15} /></button>
        </div>
      )}

      <ListToolbar lv={lv} noun="customer" selected={selected.size} filtered={hasFilters}>
        {viewMode === "grid" && lv.rows.length > 0 && (
          <label className="flex items-center gap-2 text-[12px] text-stone-400 cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className={listCheckbox} />
            Select all
          </label>
        )}
      </ListToolbar>
      <ListChips lv={lv} />

      {viewMode === "list" ? (
        <ListScroll lv={lv} empty={customers.length === 0 ? "No customers yet — create one or sync from QuickBooks." : "No customers match the current filters."}>
          <table className={listTable}>
            <ListHead lv={lv} selection={{ all: allSelected, some: selected.size > 0, onToggle: toggleAll }} />
            <tbody>
              {lv.rows.map((c: any) => {
                const isSel = selected.has(c.id);
                return (
                  <tr key={c.id} className={listRow(isSel)}>
                    <td className={listCheckCell}>
                      <input type="checkbox" checked={isSel} onChange={() => toggleOne(c.id)} className={listCheckbox} aria-label={`Select ${c.name}`} />
                    </td>
                    <td className={`${td} max-w-[240px] truncate`}>
                      <Link href={`/customers/${c.id}`} className="text-stone-200 text-[13px] font-medium hover:text-white hover:underline" title={c.name}>{c.name}</Link>
                    </td>
                    <td className={`${td} font-mono text-[12px] text-stone-500`}>{c.code?.startsWith("QBO-") ? "—" : (c.code || "—")}</td>
                    <td className={`${td} text-stone-500 text-[12px]`}>{c.countryName || "—"}</td>
                    <td className={td}>
                      <InlineAssign value={c.repId ?? null} tone="blue" title="Assign rep / ED-RM" busy={assigningId === c.id}
                        groups={repGroups} onChange={v => onAssign(c.id, "rep", v)} />
                    </td>
                    <td className={td}>
                      <InlineAssign value={c.regionId ?? null} tone="stone" title="Assign region" busy={assigningId === c.id}
                        groups={regionGroups} onChange={v => onAssign(c.id, "region", v)} />
                    </td>
                    <td className={td}>
                      {c.riskRating === "High" && <Badge variant="red" size="sm">High</Badge>}
                      {c.riskRating === "Medium" && <Badge variant="yellow" size="sm">Med</Badge>}
                      {c.riskRating === "Low" && <Badge variant="green" size="sm">Low</Badge>}
                    </td>
                    <td className={td}>
                      <Badge variant={c.effectiveStatus === "Active" ? "green" : c.effectiveStatus === "On Hold" ? "orange" : "neutral"} size="sm">{c.effectiveStatus}</Badge>
                    </td>
                    <td className={`${listNumCell} text-stone-400 text-[12px]`}>{c.openCount}</td>
                    <td className={`${listNumCell} text-[12px] ${c.overdue > 0 ? "text-rose-400 font-medium" : "text-stone-600"}`}>{fmt.money(c.overdue, c.invoiceCurrency)}</td>
                    <td className={listMoneyCell}><span className="font-medium text-stone-300 text-[13px]">{fmt.money(c.outstanding, c.invoiceCurrency)}</span></td>
                  </tr>
                );
              })}
            </tbody>
            {lv.rows.length > 0 && <ListFoot lv={lv} noun="customer" selectable />}
          </table>
        </ListScroll>
      ) : (
        /* ── CARD VIEW ── */
        <div className="flex-1 overflow-auto p-4">
          {lv.rows.length === 0 ? (
            <div className="text-center text-[13px] text-stone-400 py-16">
              {customers.length === 0 ? "No customers yet — create one or sync from QuickBooks." : "No customers match the current filters."}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {visible.map((c: any) => (
                <CustomerCard key={c.id} c={c} isSelected={selected.has(c.id)} onToggle={toggleOne} repGroups={repGroups} regionGroups={regionGroups} onAssign={onAssign} busy={assigningId === c.id} />
              ))}
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-1 mt-4">
              <span className="text-xs text-stone-500">Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, lv.rows.length)} of {lv.rows.length}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="px-3 py-1.5 text-xs rounded-md border border-stone-700 text-stone-400 disabled:opacity-40 hover:bg-stone-800/50">Prev</button>
                {Array.from({ length: totalPages }, (_, i) => (
                  <button key={i} onClick={() => setPage(i)}
                    className={`px-3 py-1.5 text-xs rounded-md border ${page === i ? "bg-stone-700 text-white border-stone-600" : "border-stone-700 text-stone-400 hover:bg-stone-800/50"}`}>{i + 1}</button>
                ))}
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                  className="px-3 py-1.5 text-xs rounded-md border border-stone-700 text-stone-400 disabled:opacity-40 hover:bg-stone-800/50">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {showCreate && <CustomerModal onClose={() => setShowCreate(false)} />}
      {showReclassify && (
        <ReclassifyModal
          ids={Array.from(selected)}
          onClose={() => { setShowReclassify(false); setSelected(new Set()); }}
        />
      )}
    </ListPage>
  );
}
