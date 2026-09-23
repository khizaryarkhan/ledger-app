"use client";

import { useState, useMemo, useCallback, memo, useEffect } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Badge, Button } from "@/components/ui";
import { ProjectModal } from "@/components/forms";
import { fmt, daysOverdue } from "@/lib/format";
import { Plus, Trash2, X, RefreshCw, Search } from "lucide-react";
import { SelectField, control, Drawer } from "@/components/form-kit";
import {
  useListView, ListPage, ListPageHeader, ListDivider, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  listTable, listRow, listCheckCell, listCheckbox, listMoneyCell, listNumCell, type ListColumn,
} from "@/components/list-view";
import { InlineAssign, type AssignGroup } from "@/components/inline-assign";

function ReclassifyModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { regions, countries, reclassifyProjects } = useData() as any;
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
      await reclassifyProjects(ids, repVal, regVal, ctyVal);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Drawer
      onClose={onClose}
      title="Reclassify projects"
      subtitle={<>Make changes to all <strong className="text-stone-300">{ids.length}</strong> selected project{ids.length > 1 ? "s" : ""}.</>}
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
            <label className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider block mb-1">Change Rep / ED/RM to</label>
            <select value={repId} onChange={e => setRepId(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800 text-stone-300 focus:border-emerald-500 focus:outline-none">
              <option value="">— No change —</option>
              <option value="null">Unassign</option>
              {freshReps.filter((r: any) => r.tier !== "ed" && r.tier !== "rd").length > 0 && (
                freshReps.filter((r: any) => r.tier !== "ed" && r.tier !== "rd")
                  .map((r: any) => <option key={r.id} value={r.id}>{r.name} (PM)</option>)
              )}
              {freshReps.filter((r: any) => r.tier === "ed" || r.tier === "rd").length > 0 && (
                freshReps.filter((r: any) => r.tier === "ed" || r.tier === "rd")
                  .map((r: any) => <option key={r.id} value={r.id}>{r.name} (ED/RM)</option>)
              )}
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

const ProjectRow = memo(function ProjectRow({ p, isSelected, onToggle, statusColor, repGroups, regionGroups, onAssign, busy }: { p: any; isSelected: boolean; onToggle: (id: string) => void; statusColor: (s: string) => string; repGroups: AssignGroup[]; regionGroups: AssignGroup[]; onAssign: (id: string, field: "rep" | "region", value: string | null) => void; busy: boolean }) {
  const td = "px-2 py-2";
  return (
    <tr className={listRow(isSelected)}>
      <td className={listCheckCell}>
        <input type="checkbox" checked={isSelected} onChange={() => onToggle(p.id)} className={listCheckbox} aria-label={`Select ${p.name}`} />
      </td>
      <td className={`${td} max-w-[260px]`}>
        <Link href={`/projects/${p.id}`} className="block truncate text-stone-200 text-[13px] font-medium hover:text-white hover:underline" title={p.name}>{p.name}</Link>
        {p.code && !p.code.startsWith("QBO-") && (
          <div className="text-[11px] text-stone-500 font-mono">{p.code}</div>
        )}
      </td>
      <td className={`${td} max-w-[200px] truncate`}>
        {p.customer
          ? <Link href={`/customers/${p.customer.id}`} className="text-stone-400 text-[12px] hover:text-white hover:underline" title={p.customer.name}>{p.customer.name}</Link>
          : <span className="text-stone-600">—</span>}
      </td>
      <td className={td}>
        <InlineAssign value={p.repId ?? null} tone="blue" title="Assign rep / ED-RM" busy={busy}
          groups={repGroups} onChange={v => onAssign(p.id, "rep", v)} />
      </td>
      <td className={td}>
        <InlineAssign value={p.regionId ?? null} tone="stone" title="Assign region" empty="—" busy={busy}
          groups={regionGroups} onChange={v => onAssign(p.id, "region", v)} />
      </td>
      <td className={`${td} text-stone-500 text-[12px]`}>{p.countryName || "—"}</td>
      <td className={td}><Badge variant={statusColor(p.effectiveStatus) as any} size="sm">{p.effectiveStatus}</Badge></td>
      <td className={`${listNumCell} text-stone-400 text-[12px]`}>{p.openCount}</td>
      <td className={`${listNumCell} text-[12px] ${p.overdue > 0 ? "text-rose-400 font-medium" : "text-stone-600"}`}>{fmt.money(p.overdue, p.customer?.currency)}</td>
      <td className={listMoneyCell}><span className="font-medium text-stone-300 text-[13px]">{fmt.money(p.outstanding, p.customer?.currency)}</span></td>
    </tr>
  );
});

export default function ProjectsPage() {
  const { projects, customers, invoices, reps, regions, countries, bulkDeleteProjects, reclassifyProjects } = useData() as any;

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
  // Resolve a rep name from both the reps table and the assignable list (covers
  // reps that only exist as org-local rows, e.g. multi-org users / admins).
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
      if (field === "rep") await reclassifyProjects([id], value);
      else await reclassifyProjects([id], undefined, value);
    } finally { setAssigningId(null); }
  }, [reclassifyProjects]);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showReclassify, setShowReclassify] = useState(false);

  const enriched = useMemo(() => projects.map((p: any) => {
    const customer = customers.find((c: any) => c.id === p.customerId);
    const projInvoices = invoices.filter((i: any) => i.projectId === p.id);
    const open = projInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" && i.txnType !== "CreditMemo");
    const outstanding = open.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
    const overdue = open.filter((i: any) => daysOverdue(i.dueDate) > 0).reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
    const region = regions.find((r: any) => r.id === p.regionId);
    const country = (countries ?? []).find((x: any) => x.id === p.countryId);
    // Compute status from outstanding — real-time, same logic as customers.
    const effectiveStatus = p.status === "On Hold" ? "On Hold" : outstanding > 0 ? "Active" : "Inactive";
    return { ...p, customer, openCount: open.length, outstanding, overdue, repName: p.repId ? repNameById.get(p.repId) : undefined, regionName: region?.name, countryName: country?.name, effectiveStatus };
  }), [projects, customers, invoices, regions, countries, repNameById]);

  const filtered = useMemo(() => {
    let res = enriched;
    if (search) {
      const s = search.toLowerCase();
      res = res.filter((p: any) =>
        p.name?.toLowerCase().includes(s) ||
        p.code?.toLowerCase().includes(s) ||
        p.customer?.name?.toLowerCase().includes(s)
      );
    }
    if (statusFilter) res = res.filter((p: any) => p.effectiveStatus === statusFilter);
    return res;
  }, [enriched, search, statusFilter]);

  const PROJ_COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "name",      label: "Project",  sort: r => r.name, filter: { kind: "text", value: r => r.name } },
    { key: "customer",  label: "Customer", sort: r => r.customer?.name, filter: { kind: "text", value: r => r.customer?.name } },
    { key: "rep",       label: "Rep",      sort: r => r.repName, filter: { kind: "multi", value: r => r.repName } },
    { key: "region",    label: "Region",   sort: r => r.regionName, filter: { kind: "multi", value: r => r.regionName } },
    { key: "country",   label: "Country",  sort: r => r.countryName, filter: { kind: "multi", value: r => r.countryName } },
    // Filters on the status the row SHOWS (effectiveStatus), not the stored one.
    { key: "status",    label: "Status",   sort: r => r.effectiveStatus, filter: { kind: "multi", value: r => r.effectiveStatus } },
    { key: "openCount", label: "Open inv.", sort: r => r.openCount, descFirst: true, align: "right", filter: { kind: "range", value: r => r.openCount }, sum: r => r.openCount },
    { key: "overdue",   label: "Overdue",  sort: r => r.overdue, descFirst: true, align: "right",
      filter: { kind: "range", value: r => r.overdue }, money: r => ({ amount: r.overdue, currency: r.customer?.currency }) },
    { key: "outstanding", label: "Outstanding", sort: r => r.outstanding, descFirst: true, align: "right",
      filter: { kind: "range", value: r => r.outstanding }, money: r => ({ amount: r.outstanding, currency: r.customer?.currency }) },
  ], []);

  const lv = useListView(filtered, PROJ_COLS, { storageKey: "projects", defaultSort: "outstanding", defaultDir: "desc", summary: "outstanding" });

  // Prune the selection when filters hide rows (board rule).
  useEffect(() => {
    const visibleIds = new Set(lv.rows.map((p: any) => p.id));
    setSelected(prev => [...prev].some(id => !visibleIds.has(id)) ? new Set([...prev].filter(id => visibleIds.has(id))) : prev);
  }, [lv.rows]);

  const allSelected = lv.rows.length > 0 && lv.rows.every((p: any) => selected.has(p.id));
  const toggleAll = () => allSelected ? setSelected(new Set()) : setSelected(new Set(lv.rows.map((p: any) => p.id)));
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

  const statusColor = useCallback((s: string) => ({ "Active": "blue", "Inactive": "neutral", "On Hold": "orange", "In Progress": "purple", "Completed": "green", "Pending": "yellow", "Cancelled": "neutral" }[s] || "neutral"), []);
  const pageFiltered = !!(search || statusFilter);

  return (
    <ListPage>
      <ListPageHeader title="Projects" subtitle={<>{projects.length} project{projects.length !== 1 ? "s" : ""}</>}>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search project, code, customer…"
            className={`${control} h-8 w-56 pl-7 pr-2 text-xs`} />
        </div>
        {/* Rep and region moved to their column funnels. Status stays up here
            because it defaults to Active, and a default belongs where it's seen. */}
        <SelectField value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status" className="w-auto h-8 text-xs">
          <option value="">All statuses</option>
          {["Active", "Inactive", "On Hold"].map(s => <option key={s} value={s}>{s}</option>)}
        </SelectField>
        {(search || statusFilter !== "Active") && (
          <button onClick={() => { setSearch(""); setStatusFilter("Active"); }}
            className="text-[11px] text-stone-500 hover:text-rose-400 font-medium px-1">Clear</button>
        )}
        <ListDivider />
        <Button icon={Plus} size="sm" onClick={() => setShowCreate(true)}>New project</Button>
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

      <ListToolbar lv={lv} noun="project" selected={selected.size} filtered={pageFiltered} />
      <ListChips lv={lv} />

      <ListScroll lv={lv} empty={projects.length === 0 ? "No projects yet — projects group invoices for a customer engagement." : "No projects match the current filters."}>
        <table className={listTable}>
          <ListHead lv={lv} selection={{ all: allSelected, some: selected.size > 0, onToggle: toggleAll }} />
          <tbody>
            {lv.rows.map((p: any) => (
              <ProjectRow key={p.id} p={p} isSelected={selected.has(p.id)} onToggle={toggleOne} statusColor={statusColor} repGroups={repGroups} regionGroups={regionGroups} onAssign={onAssign} busy={assigningId === p.id} />
            ))}
          </tbody>
          {lv.rows.length > 0 && <ListFoot lv={lv} noun="project" selectable />}
        </table>
      </ListScroll>

      {showCreate && <ProjectModal onClose={() => setShowCreate(false)} />}
      {showReclassify && (
        <ReclassifyModal
          ids={Array.from(selected)}
          onClose={() => { setShowReclassify(false); setSelected(new Set()); }}
        />
      )}
    </ListPage>
  );
}
