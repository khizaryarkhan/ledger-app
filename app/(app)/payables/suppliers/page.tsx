"use client";

import { useState, useEffect, useMemo, useCallback, memo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Plus,
  Users,
  AlertCircle,
  LayoutGrid,
  List,
} from "lucide-react";
import { Card, Badge, Button, Input, Select, Modal } from "@/components/ui";
import { fmt } from "@/lib/format";
import { SelectField, control } from "@/components/form-kit";
import {
  useListView, ListPage, ListPageHeader, ListDivider, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  listTable, listRow, listCheckCell, listCheckbox, listMoneyCell, listNumCell, type ListColumn,
} from "@/components/list-view";

// ── Supplier card (grid view) — mirrors AR CustomerCard ────────────────────────
const SupplierCard = memo(function SupplierCard({
  s, isSelected, onToggle,
}: { s: any; isSelected: boolean; onToggle: (id: string) => void }) {
  return (
    <div className={`relative rounded-lg ring-1 transition-colors ${isSelected ? "ring-violet-500 ring-2" : "ring-stone-700 hover:ring-stone-600"}`}>
      <div className="absolute top-3 left-3 z-10">
        <input type="checkbox" checked={isSelected} onChange={() => onToggle(s.id)}
          className="rounded border-stone-600 cursor-pointer" onClick={(e) => e.stopPropagation()} />
      </div>
      <Link href={`/payables/suppliers/${s.id}`}>
        <Card className="cursor-pointer h-full ring-0 hover:ring-0">
          <div className="flex items-start gap-3 mb-3 pl-5">
            <div className="w-10 h-10 rounded-md bg-gradient-to-br from-stone-700 to-stone-800 flex items-center justify-center text-stone-300 text-sm font-semibold flex-shrink-0">
              {(s.name || "?").split(" ").slice(0, 2).map((w: string) => w[0]).join("")}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate">{s.name}</div>
              <div className="text-[11px] text-stone-500 mt-0.5">
                {s.code ? `${s.code} · ` : ""}{s.country || "—"}
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className="text-[10px] bg-stone-800 text-stone-400 px-1.5 py-0.5 rounded font-medium">{normalizeSource(s.source)}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1 items-end">
              {s.riskRating === "High" && <Badge variant="red" size="sm">High</Badge>}
              {s.riskRating === "Medium" && <Badge variant="yellow" size="sm">Med</Badge>}
              {s.status !== "Active" && <Badge variant="orange" size="sm">{s.status}</Badge>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-stone-800">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Outstanding</div>
              <div className="text-sm font-semibold text-white tabular-nums mt-0.5">{fmt.money(s.totalOutstanding, s.currency)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Overdue</div>
              <div className={`text-sm font-semibold tabular-nums mt-0.5 ${s.overdueCount > 0 ? "text-rose-400" : "text-white"}`}>{s.overdueCount || 0}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Open bills</div>
              <div className="text-sm font-semibold text-white tabular-nums mt-0.5">{s.openBillsCount}</div>
            </div>
          </div>
        </Card>
      </Link>
    </div>
  );
});

// ── Types ────────────────────────────────────────────────────────────────────

type SupplierStatus = "Active" | "Inactive" | "Suspended";
type SupplierSource = "qbo" | "xero" | "manual";

interface Supplier {
  id: string;
  name: string;
  displayName?: string;
  code?: string;
  email?: string;
  phone?: string;
  currency: string;
  paymentTerms?: number;
  status: SupplierStatus;
  source: SupplierSource | string;
  lastSynced?: string;
  country?: string;
  taxNumber?: string;
  riskRating?: string;
  totalOutstanding: number;
  overdueCount: number;
  openBillsCount: number;
  createdAt?: string;
}

type StatusFilter = "All" | "Active" | "Inactive" | "Suspended";
type SourceFilter = "All" | "QBO" | "Xero" | "Manual";

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeSource(source: string | undefined | null): string {
  if (!source) return "Manual";
  const map: Record<string, string> = { qbo: "QBO", xero: "Xero", manual: "Manual" };
  return map[source.toLowerCase()] ?? source;
}

function sourceBadgeVariant(source: string): string {
  const normalized = normalizeSource(source);
  const map: Record<string, string> = { QBO: "blue", Xero: "purple", Manual: "neutral" };
  return map[normalized] ?? "neutral";
}

function statusBadgeVariant(status: SupplierStatus) {
  return status === "Active" ? "green" : "neutral";
}

function riskBadgeVariant(risk: string | undefined | null): string {
  const map: Record<string, string> = { Low: "green", Medium: "yellow", High: "red" };
  return (risk && map[risk]) ?? "neutral";
}

// ── Add Supplier Modal ────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: "",
  displayName: "",
  code: "",
  email: "",
  phone: "",
  currency: "",
  paymentTerms: "",
  country: "",
  taxNumber: "",
  status: "Active" as SupplierStatus,
};

function AddSupplierModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (supplier: Supplier) => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default the currency field to the org's home currency — never hardcode
  // one, since a supplier created here with no explicit choice should match
  // the books it's posted into, not an arbitrary literal.
  useEffect(() => {
    fetch("/api/org/settings").then(r => r.json()).then(o => {
      if (o?.currency) setForm(prev => (prev.currency ? prev : { ...prev, currency: o.currency }));
    }).catch(() => {});
  }, []);

  function set(field: keyof typeof EMPTY_FORM) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Supplier name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          paymentTerms: form.paymentTerms ? Number(form.paymentTerms) : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error ${res.status}`);
      }
      const supplier = await res.json();
      onAdded(supplier);
      setForm(EMPTY_FORM);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to add supplier");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Supplier"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <button
            type="submit"
            form="add-supplier-form"
            disabled={saving}
            className="inline-flex items-center justify-center font-medium rounded-md transition-colors bg-violet-600 text-white hover:bg-violet-500 disabled:bg-stone-700 disabled:text-stone-500 h-9 px-3.5 text-sm gap-2"
          >
            {saving ? "Saving…" : "Add Supplier"}
          </button>
        </>
      }
    >
      <form
        id="add-supplier-form"
        onSubmit={handleSubmit}
        className="p-5 space-y-4"
      >
        {error && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-400 text-sm">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {/* Name */}
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Name <span className="text-rose-400">*</span>
            </label>
            <Input
              value={form.name}
              onChange={set("name")}
              placeholder="Acme Corp"
            />
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Display Name
            </label>
            <Input
              value={form.displayName}
              onChange={set("displayName")}
              placeholder="Optional"
            />
          </div>

          {/* Code */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Code
            </label>
            <Input
              value={form.code}
              onChange={set("code")}
              placeholder="SUP-001"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Email
            </label>
            <Input
              type="email"
              value={form.email}
              onChange={set("email")}
              placeholder="accounts@acme.com"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Phone
            </label>
            <Input
              value={form.phone}
              onChange={set("phone")}
              placeholder="+1 555 000 0000"
            />
          </div>

          {/* Currency */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Currency
            </label>
            <Select
              value={form.currency}
              onChange={set("currency")}
              options={["USD", "EUR", "GBP", "AED"]}
              className="w-full"
            />
          </div>

          {/* Payment Terms */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Payment Terms (days)
            </label>
            <Input
              type="number"
              value={form.paymentTerms}
              onChange={set("paymentTerms")}
              placeholder="30"
            />
          </div>

          {/* Country */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Country
            </label>
            <Input
              value={form.country}
              onChange={set("country")}
              placeholder="United States"
            />
          </div>

          {/* Tax Number */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Tax Number
            </label>
            <Input
              value={form.taxNumber}
              onChange={set("taxNumber")}
              placeholder="Optional"
            />
          </div>

          {/* Status */}
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Status
            </label>
            <Select
              value={form.status}
              onChange={set("status")}
              options={["Active", "Inactive"]}
              className="w-full"
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ── Column definitions — sort + funnel filter per column, board-style ─────────
// Risk/Status/Source stay ALSO as header selects (below) because the grid view
// has no column headers to hang a funnel from; the list view adds these column
// filters on top, same split as the AR Customers list (customers/page.tsx).
const SUPPLIER_COLS: ListColumn<Supplier>[] = [
  { key: "name",             label: "Supplier", sort: r => r.name, filter: { kind: "text", value: r => r.name } },
  { key: "code",             label: "Code",     sort: r => r.code ?? "", filter: { kind: "text", value: r => r.code } },
  { key: "country",          label: "Country",  sort: r => r.country, filter: { kind: "multi", value: r => r.country } },
  { key: "riskRating",       label: "Risk",     sort: r => r.riskRating, filter: { kind: "multi", value: r => r.riskRating } },
  { key: "status",           label: "Status",   sort: r => r.status, filter: { kind: "multi", value: r => r.status } },
  { key: "source",           label: "Source",   sort: r => normalizeSource(r.source), filter: { kind: "multi", value: r => normalizeSource(r.source) } },
  { key: "totalOutstanding", label: "Outstanding", sort: r => r.totalOutstanding ?? 0, descFirst: true, align: "right",
    money: r => ({ amount: r.totalOutstanding ?? 0, currency: r.currency }) },
  { key: "overdueCount",     label: "Overdue",    sort: r => r.overdueCount ?? 0, descFirst: true, align: "right", sum: r => r.overdueCount ?? 0 },
  { key: "openBillsCount",   label: "Open Bills", sort: r => r.openBillsCount ?? 0, descFirst: true, align: "right", sum: r => r.openBillsCount ?? 0 },
];

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SuppliersPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Active");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("All");
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 48;

  // "Add supplier" from the Create menu (any module) lands here with ?new=1
  // and opens the same modal the inline "Add" button uses — one real add
  // flow, not a second one on a thinner accounting-only screen.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setShowAdd(true);
      router.replace("/payables/suppliers");
    }
  }, [searchParams, router]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/suppliers");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      setSuppliers(Array.isArray(json) ? json : json.suppliers ?? []);
    } catch (e: any) {
      setError(e.message || "Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    let rows = suppliers;
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (sup) =>
          sup.name.toLowerCase().includes(s) ||
          (sup.code ?? "").toLowerCase().includes(s) ||
          (sup.email ?? "").toLowerCase().includes(s)
      );
    }
    if (riskFilter) {
      rows = rows.filter((s) => s.riskRating === riskFilter);
    }
    if (statusFilter !== "All") {
      rows = rows.filter((s) => s.status === statusFilter);
    }
    if (sourceFilter !== "All") {
      rows = rows.filter((s) => normalizeSource(s.source) === sourceFilter);
    }
    return rows;
  }, [suppliers, search, riskFilter, statusFilter, sourceFilter]);

  const lv = useListView(filtered, SUPPLIER_COLS, { storageKey: "payables-suppliers", defaultSort: "totalOutstanding", defaultDir: "desc", summary: "totalOutstanding" });

  // Prune the selection when filters hide rows (board rule).
  useEffect(() => {
    const visibleIds = new Set(lv.rows.map((s: any) => s.id));
    setSelected(prev => [...prev].some(id => !visibleIds.has(id)) ? new Set([...prev].filter(id => visibleIds.has(id))) : prev);
  }, [lv.rows]);

  const hasFilters = !!(search || riskFilter || statusFilter !== "Active" || sourceFilter !== "All");

  const allSelected = lv.rows.length > 0 && lv.rows.every((r: any) => selected.has(r.id));
  const toggleAll = useCallback(() => {
    allSelected
      ? setSelected(new Set())
      : setSelected(new Set(lv.rows.map((r: any) => r.id)));
  }, [allSelected, lv.rows]);
  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // Card view pages through the same filtered + sorted rows the list shows.
  useEffect(() => { setPage(0); }, [search, riskFilter, statusFilter, sourceFilter, lv.filters]);
  const totalPages = Math.ceil(lv.rows.length / PAGE_SIZE);
  const visible = useMemo(() => lv.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [lv.rows, page]);

  const td = "px-2 py-2";
  const viewBtn = (on: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${on ? "bg-violet-600 text-white shadow-sm" : "text-stone-400 hover:text-stone-200"}`;

  return (
    <ListPage>
      <ListPageHeader title="Suppliers" subtitle={<>{loading ? "Loading…" : `${lv.rows.length} supplier${lv.rows.length !== 1 ? "s" : ""}`}</>}>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code or email…"
            className={`${control} h-8 w-56 pl-7 pr-2 text-xs`} />
        </div>
        {/* Header filters stay because the card view has no column headers to
            put a funnel on; the list view adds per-column filters on top. */}
        <SelectField value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} aria-label="Filter by status" className="w-auto h-8 text-xs">
          <option value="All">All statuses</option>
          {["Active", "Inactive", "Suspended"].map(s => <option key={s} value={s}>{s}</option>)}
        </SelectField>
        <SelectField value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} aria-label="Filter by risk" className="w-auto h-8 text-xs">
          <option value="">All risk levels</option>
          {["Low", "Medium", "High"].map(s => <option key={s} value={s}>{s}</option>)}
        </SelectField>
        <SelectField value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as SourceFilter)} aria-label="Filter by source" className="w-auto h-8 text-xs">
          {["All", "QBO", "Xero", "Manual"].map(s => <option key={s} value={s}>{s === "All" ? "All sources" : s}</option>)}
        </SelectField>
        {hasFilters && (
          <button onClick={() => { setSearch(""); setRiskFilter(""); setStatusFilter("Active"); setSourceFilter("All"); }}
            className="text-[11px] text-stone-500 hover:text-rose-400 font-medium px-1">Clear</button>
        )}
        <ListDivider />
        <div className="flex bg-stone-800 rounded-md p-0.5 border border-stone-700">
          <button onClick={() => setViewMode("grid")} className={viewBtn(viewMode === "grid")}><LayoutGrid size={12} /> Cards</button>
          <button onClick={() => setViewMode("list")} className={viewBtn(viewMode === "list")}><List size={12} /> List</button>
        </div>
        <Button icon={Plus} size="sm" onClick={() => setShowAdd(true)}>Add supplier</Button>
      </ListPageHeader>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-stone-800 bg-rose-500/10 text-rose-400 text-sm shrink-0">
          <AlertCircle size={14} />
          {error}
          <button onClick={load} className="ml-auto underline hover:no-underline text-rose-300">Retry</button>
        </div>
      )}

      <ListToolbar lv={lv} noun="supplier" filtered={hasFilters}>
        {viewMode === "grid" && lv.rows.length > 0 && (
          <label className="flex items-center gap-2 text-[12px] text-stone-400 cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className={listCheckbox} />
            Select all
          </label>
        )}
      </ListToolbar>
      <ListChips lv={lv} />

      {loading ? (
        <div className="flex-1 overflow-auto p-5 space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="animate-pulse bg-stone-800 rounded h-10 w-full" />
          ))}
        </div>
      ) : viewMode === "list" ? (
        <ListScroll lv={lv} empty={suppliers.length === 0 ? "No suppliers yet — add one to get started." : "No suppliers match the current filters."}>
          <table className={listTable}>
            <ListHead lv={lv} selection={{ all: allSelected, some: selected.size > 0, onToggle: toggleAll }} />
            <tbody>
              {lv.rows.map((sup: any) => {
                const isSel = selected.has(sup.id);
                return (
                  <tr key={sup.id} onClick={() => router.push(`/payables/suppliers/${sup.id}`)} className={`${listRow(isSel)} cursor-pointer`}>
                    <td className={listCheckCell} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSel} onChange={() => toggleOne(sup.id)} className={listCheckbox} aria-label={`Select ${sup.name}`} />
                    </td>
                    <td className={`${td} font-medium text-white text-[13px] whitespace-nowrap`}>{sup.name}</td>
                    <td className={`${td} font-mono text-[12px] text-stone-500`}>{sup.code || "—"}</td>
                    <td className={`${td} text-stone-500 text-[12px]`}>{sup.country || "—"}</td>
                    <td className={td}>
                      {sup.riskRating ? <Badge variant={riskBadgeVariant(sup.riskRating)} size="sm">{sup.riskRating}</Badge> : <span className="text-stone-600 text-[12px]">—</span>}
                    </td>
                    <td className={td}><Badge variant={statusBadgeVariant(sup.status)} size="sm">{sup.status}</Badge></td>
                    <td className={td}><Badge variant={sourceBadgeVariant(sup.source)} size="sm">{normalizeSource(sup.source)}</Badge></td>
                    <td className={listMoneyCell}>
                      <span className={sup.totalOutstanding > 0 ? "font-medium text-stone-300 text-[13px]" : "text-stone-500"}>{fmt.money(sup.totalOutstanding, sup.currency)}</span>
                    </td>
                    <td className={`${listNumCell} ${sup.overdueCount > 0 ? "text-rose-400 font-medium" : "text-stone-600"}`}>{sup.overdueCount > 0 ? sup.overdueCount : "—"}</td>
                    <td className={`${listNumCell} text-stone-400 text-[12px]`}>{sup.openBillsCount}</td>
                  </tr>
                );
              })}
            </tbody>
            {lv.rows.length > 0 && <ListFoot lv={lv} noun="supplier" selectable />}
          </table>
        </ListScroll>
      ) : (
        /* ── CARD VIEW ── */
        <div className="flex-1 overflow-auto p-4">
          {lv.rows.length === 0 ? (
            <div className="text-center text-[13px] text-stone-400 py-16">
              {suppliers.length === 0 ? "No suppliers yet — add one to get started." : "No suppliers match the current filters."}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {visible.map((s: any) => (
                <SupplierCard key={s.id} s={s} isSelected={selected.has(s.id)} onToggle={toggleOne} />
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

      <AddSupplierModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={(sup) => setSuppliers((prev) => [sup, ...prev])}
      />
    </ListPage>
  );
}
