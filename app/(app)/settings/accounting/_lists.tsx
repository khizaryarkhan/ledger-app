"use client";

/**
 * Settings → Accounting — QBO-style masters: Chart of Accounts, Products &
 * Services, Tax Rates. Shows records synced from QBO/Xero (read-only, badge
 * shows source) alongside native records created here (fully editable).
 * First phase of the standalone-accounting roadmap.
 */

import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, Plus, Pencil, Search, X, Lock, RefreshCw, BookOpen, Package, Percent, Tags, Sparkles } from "lucide-react";
import { CURRENCIES } from "@/lib/accounting/currencies";
import { Drawer } from "@/components/form-kit";
import { fmt } from "@/lib/format";
import { listTable, listRow, listCell, listNumCell } from "@/components/list-view";
import { QBO_ACCOUNT_SUBTYPES, subtypeLabel } from "@/lib/accounting/qbo-account-subtypes";

// ── QBO taxonomy ────────────────────────────────────────────────────────────
// Detail-type (AccountSubType) options come from QBO_ACCOUNT_SUBTYPES — the
// real wire-format codes QuickBooks itself uses — so a synced QBO account's
// stored subtype always matches an option here instead of showing blank.
const TYPE_GROUPS: [string, string[]][] = [
  ["Assets", ["Bank", "Accounts Receivable", "Other Current Asset", "Fixed Asset", "Other Asset"]],
  ["Liabilities", ["Accounts Payable", "Credit Card", "Other Current Liability", "Long Term Liability"]],
  ["Equity", ["Equity"]],
  ["Income", ["Income", "Other Income"]],
  ["Expenses", ["Cost of Goods Sold", "Expense", "Other Expense"]],
];

// Orders a flat list of accounts so each parent is immediately followed by
// its own children (recursively), alphabetically at every level.
// accounts.parent_id is always our internal id (see
// lib/accounting/account-parent.ts), whether set by the native picker or
// resolved by the QBO sync — never a raw external id.
function nestAccounts(list: Rec[]): (Rec & { depth: number })[] {
  const byId = new Map(list.map(r => [r.id, r]));
  const childrenOf = new Map<string, Rec[]>();
  const roots: Rec[] = [];
  for (const r of list) {
    const parent = r.parentId ? byId.get(r.parentId) : undefined;
    if (parent && parent.id !== r.id) {
      if (!childrenOf.has(parent.id)) childrenOf.set(parent.id, []);
      childrenOf.get(parent.id)!.push(r);
    } else {
      roots.push(r);
    }
  }
  const byName = (a: Rec, b: Rec) => (a.name ?? "").localeCompare(b.name ?? "");
  roots.sort(byName);
  for (const kids of childrenOf.values()) kids.sort(byName);

  const out: (Rec & { depth: number })[] = [];
  const visited = new Set<string>();
  function walk(r: Rec, depth: number) {
    if (visited.has(r.id)) return; // cycle guard — shouldn't happen, API refuses cycles
    visited.add(r.id);
    out.push({ ...r, depth });
    for (const child of childrenOf.get(r.id) ?? []) walk(child, depth + 1);
  }
  for (const r of roots) walk(r, 0);
  return out;
}
const ITEM_TYPES = ["Service", "Non-Inventory", "Inventory"];
const dimTypeLabel = (t: string) => t === "TrackingCategory" ? "Tracking category" : t === "CostCentre" ? "Cost centre" : t === "CustomField" ? "Custom field" : t;
// QBO's API calls Locations "Department" — treat both as the Locations tab.
const LOCATION_TYPES = new Set(["Location", "Department"]);
// Types with a dedicated tab; anything else in ap_dimensions lands in "Other".
const DEDICATED_DIM_TYPES = new Set(["Class", "Location", "Department", "CostCentre", "CustomField"]);

type Rec = any;
type Tab = "accounts" | "items" | "tax-rates" | "classes" | "locations" | "cost-centres" | "custom-fields" | "other-dims";
const DIM_TABS: Tab[] = ["classes", "locations", "cost-centres", "custom-fields", "other-dims"];
// Which API entity a tab talks to.
const apiEntity = (t: Tab) => DIM_TABS.includes(t) ? "dimensions" : t;

const sourceBadge = (source: string) => {
  const cls: Record<string, string> = {
    native: "bg-emerald-500/10 text-emerald-400 border-emerald-800",
    qbo:    "bg-sky-500/10 text-sky-400 border-sky-800",
    xero:   "bg-blue-500/10 text-blue-400 border-blue-800",
    sage:   "bg-violet-500/10 text-violet-400 border-violet-800",
  };
  const label: Record<string, string> = { native: "Native", qbo: "QuickBooks", xero: "Xero", sage: "Sage" };
  return <span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${cls[source] ?? cls.native}`}>{label[source] ?? source}</span>;
};

// Reusable lists screen. `initialTab` lets the Accounting workspace deep-link a
// specific list from the sidebar; `hideTabs` drops the in-page tab bar when the
// sidebar is already driving list selection.
export function AccountingLists({ initialTab = "accounts", hideTabs = false }: { initialTab?: Tab; hideTabs?: boolean }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [seeding, setSeeding] = useState(false);
  const [data, setData] = useState<{ accounts: Rec[]; items: Rec[]; "tax-rates": Rec[]; dimensions: Rec[] }>({ accounts: [], items: [], "tax-rates": [], dimensions: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editRec, setEditRec] = useState<Rec | "new" | null>(null); // null = closed
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [mcEnabled, setMcEnabled] = useState(false);
  const [homeCcy, setHomeCcy] = useState("");

  useEffect(() => {
    fetch("/api/org/settings").then(r => r.json()).then(o => {
      setMcEnabled(!!o?.multicurrencyEnabled);
      setHomeCcy(o?.currency ?? "");
    }).catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [a, i, t, d] = await Promise.all([
        fetch("/api/accounting/accounts").then(r => r.json()),
        fetch("/api/accounting/items").then(r => r.json()),
        fetch("/api/accounting/tax-rates").then(r => r.json()),
        fetch("/api/accounting/dimensions").then(r => r.json()),
      ]);
      setData({ accounts: Array.isArray(a) ? a : [], items: Array.isArray(i) ? i : [], "tax-rates": Array.isArray(t) ? t : [], dimensions: Array.isArray(d) ? d : [] });
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  // Opened from the + Create launcher (…/accounts?new=1) — auto-open the modal.
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") openNew();
  }, []);

  // Seed the standard starter Chart of Accounts (idempotent — fills gaps only).
  async function seedDefaults() {
    if (seeding) return;
    setSeeding(true);
    try {
      const res = await fetch("/api/accounts/seed", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to set up accounts");
      await load();
    } catch { /* surfaced by empty result if it fails */ } finally { setSeeding(false); }
  }

  // Records backing a tab — dimension tabs slice data.dimensions by type.
  const tabSource = (t: Tab): Rec[] => {
    if (t === "classes")       return data.dimensions.filter(r => r.dimensionType === "Class");
    if (t === "locations")     return data.dimensions.filter(r => LOCATION_TYPES.has(r.dimensionType));
    if (t === "cost-centres")  return data.dimensions.filter(r => r.dimensionType === "CostCentre");
    if (t === "custom-fields") return data.dimensions.filter(r => r.dimensionType === "CustomField");
    if (t === "other-dims")    return data.dimensions.filter(r => !DEDICATED_DIM_TYPES.has(r.dimensionType));
    return (data as any)[t] ?? [];
  };

  const rows = useMemo(() => {
    let list = tabSource(tab);
    if (!showInactive) list = list.filter(r => r.status !== "Inactive");
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r => (r.name ?? "").toLowerCase().includes(q) || (r.code ?? "").toLowerCase().includes(q) || (r.type ?? "").toLowerCase().includes(q) || (r.dimensionType ?? "").toLowerCase().includes(q));
    }
    return list;
  }, [data, tab, search, showInactive]);

  // Accounts grouped by type for the CoA view (QBO groups by classification).
  const accountGroups = useMemo(() => {
    if (tab !== "accounts") return [];
    return TYPE_GROUPS.map(([group, types]) => ({
      group,
      rows: nestAccounts(rows.filter(r => types.includes(r.type))),
    })).filter(g => g.rows.length > 0)
      .concat((() => {
        const known = new Set(TYPE_GROUPS.flatMap(([, t]) => t));
        const other = rows.filter(r => !known.has(r.type));
        return other.length ? [{ group: "Other", rows: nestAccounts(other) }] : [];
      })());
  }, [rows, tab]);

  const incomeAccounts  = useMemo(() => data["accounts"].filter(a => ["Income", "Other Income"].includes(a.type) && a.status !== "Inactive"), [data]);
  const expenseAccounts = useMemo(() => data["accounts"].filter(a => ["Expense", "Cost of Goods Sold", "Other Expense"].includes(a.type) && a.status !== "Inactive"), [data]);
  const taxRates        = useMemo(() => data["tax-rates"].filter(t => t.status !== "Inactive"), [data]);

  function openNew() {
    setErrMsg("");
    if (tab === "accounts")  setForm({ name: "", type: "Expense", subtype: "", code: "", currency: "", parentId: "" });
    if (tab === "items")     setForm({ name: "", itemType: "Service", code: "", description: "", unitPrice: "", unitCost: "", incomeAccountId: "", expenseAccountId: "", taxRateId: "" });
    if (tab === "tax-rates") setForm({ name: "", rate: "", taxType: "" });
    if (tab === "classes")       setForm({ name: "", dimensionType: "Class", code: "" });
    if (tab === "locations")     setForm({ name: "", dimensionType: "Location", code: "" });
    if (tab === "cost-centres")  setForm({ name: "", dimensionType: "CostCentre", code: "" });
    if (tab === "custom-fields") setForm({ name: "", dimensionType: "CustomField", code: "" });
    if (tab === "other-dims")    setForm({ name: "", dimensionType: "Custom", code: "" });
    setEditRec("new");
  }
  function openEdit(r: Rec) {
    setErrMsg("");
    setForm({ ...r, unitPrice: r.unitPrice ?? "", unitCost: r.unitCost ?? "", rate: r.rate ?? "", subtype: r.subtype ?? "", code: r.code ?? "", description: r.description ?? "", taxType: r.taxType ?? "", incomeAccountId: r.incomeAccountId ?? "", expenseAccountId: r.expenseAccountId ?? "", taxRateId: r.taxRateId ?? "", parentId: r.parentId ?? "" });
    setEditRec(r);
  }

  async function save() {
    setSaving(true); setErrMsg("");
    try {
      const isNew = editRec === "new";
      const payload: Record<string, any> = { ...form };
      // Coerce numerics; strip empties
      ["unitPrice", "unitCost", "rate"].forEach(k => {
        if (payload[k] === "" || payload[k] == null) delete payload[k];
        else payload[k] = Number(payload[k]);
      });
      ["subtype", "code", "description", "taxType", "incomeAccountId", "expenseAccountId", "taxRateId", "currency"].forEach(k => {
        if (payload[k] === "") delete payload[k];
      });
      // Parent account: "" (the "No parent" option) means explicitly clear it,
      // not "leave unchanged" — so send null rather than omitting the key.
      if (tab === "accounts") payload.parentId = payload.parentId || null;
      // Only send known fields
      delete payload.id; delete payload.orgId; delete payload.source; delete payload.externalId;
      delete payload.raw; delete payload.lastSyncedAt; delete payload.createdAt; delete payload.updatedAt;
      delete payload.status; delete payload.purchaseAccountId;

      const url = isNew ? `/api/accounting/${apiEntity(tab)}` : `/api/accounting/${apiEntity(tab)}/${(editRec as Rec).id}`;
      const res = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErrMsg(d.error || "Failed to save"); return; }
      setEditRec(null);
      await load();
    } finally { setSaving(false); }
  }

  async function toggleStatus(r: Rec) {
    await fetch(`/api/accounting/${apiEntity(tab)}/${r.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: r.status === "Inactive" ? "Active" : "Inactive" }),
    });
    await load();
  }

  const acctName = (id: string | null) => data["accounts"].find(a => a.id === id || a.externalId === id)?.name ?? "—";

  // "Other dimensions" tab only appears when the org actually has such data
  // (tracking categories, cost centres…) — Classes and Locations always show.
  const hasOtherDims = data.dimensions.some(r => !DEDICATED_DIM_TYPES.has(r.dimensionType));
  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "accounts",      label: "Chart of Accounts",   icon: <BookOpen size={13} /> },
    { key: "items",         label: "Products & Services", icon: <Package size={13} /> },
    { key: "tax-rates",     label: "Tax Rates",           icon: <Percent size={13} /> },
    { key: "classes",       label: "Classes",             icon: <Tags size={13} /> },
    { key: "locations",     label: "Locations",           icon: <Tags size={13} /> },
    { key: "cost-centres",  label: "Cost Centres",        icon: <Tags size={13} /> },
    { key: "custom-fields", label: "Custom Fields",       icon: <Tags size={13} /> },
    ...(hasOtherDims ? [{ key: "other-dims" as Tab, label: "Other Dimensions", icon: <Tags size={13} /> }] : []),
  ];

  // Other-dimensions grouped by type (tracking categories, cost centres…)
  const dimensionGroups = useMemo(() => {
    if (tab !== "other-dims") return [];
    const m = new Map<string, Rec[]>();
    rows.forEach(r => {
      const k = r.dimensionType ?? "Other";
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    });
    return [...m.entries()]
      .map(([type, list]) => ({ type, rows: list.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")) }))
      .sort((a, b) => a.type.localeCompare(b.type));
  }, [rows, tab]);

  const inputCls = "w-full text-[13px] border border-stone-700 rounded-lg px-3 py-2 bg-stone-900 text-stone-200 placeholder-stone-600 outline-none focus:ring-1 focus:ring-emerald-500";
  const labelCls = "block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1";
  // Matches list-view.tsx's (unexported) header-cell style, so this hand-rolled
  // table reads as the same design system as the funnel-filter tables.
  const thCls = "px-2 py-2 text-[11px] font-medium text-stone-500 whitespace-nowrap text-left";

  const isSyncedEdit = editRec && editRec !== "new" && (editRec as Rec).source !== "native";

  return (
    <div className="min-h-screen bg-stone-950 text-stone-200">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <Link href="/settings" className="inline-flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-300 mb-2">
          <ChevronLeft size={13} /> Settings
        </Link>
        <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
          <div>
            <h1 className="text-xl font-bold text-white">Accounting</h1>
            <p className="text-[13px] text-stone-500 mt-0.5">
              Chart of accounts, products & services, and tax rates. Records synced from QuickBooks/Xero are read-only; records created here are native to this app.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/accounting/journal"
              className="flex items-center gap-1.5 text-[13px] font-medium text-stone-300 border border-stone-700 rounded-lg px-3.5 py-2 hover:bg-stone-800 transition-colors">
              <BookOpen size={14} /> General Ledger
            </Link>
            <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
            {tab === "accounts" && (
              <button onClick={seedDefaults} disabled={seeding} title="Add the full standard starter chart (income, expense, asset, liability accounts). System accounts already exist automatically."
                className="flex items-center gap-1.5 text-[13px] font-medium text-stone-300 border border-stone-700 rounded-lg px-3.5 py-2 hover:bg-stone-800 disabled:opacity-50 transition-colors">
                {seeding ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />} Add starter chart
              </button>
            )}
            <button onClick={openNew}
              className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700 transition-colors">
              <Plus size={14} /> New {tab === "accounts" ? "account" : tab === "items" ? "item" : tab === "tax-rates" ? "tax rate" : tab === "classes" ? "class" : tab === "locations" ? "location" : tab === "cost-centres" ? "cost centre" : tab === "custom-fields" ? "custom field" : "dimension"}
            </button>
          </div>
        </div>

        {/* Tabs */}
        {!hideTabs && (
        <div className="flex items-center gap-1 border-b border-stone-800 mb-4">
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setSearch(""); }}
              className={`flex items-center gap-1.5 text-[13px] font-medium px-3.5 py-2.5 border-b-2 -mb-px transition-colors ${tab === t.key ? "border-emerald-500 text-white" : "border-transparent text-stone-500 hover:text-stone-300"}`}>
              {t.icon} {t.label}
              <span className="text-[11px] text-stone-600 ml-0.5">{tabSource(t.key).filter(r => r.status !== "Inactive").length}</span>
            </button>
          ))}
        </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, code, type…"
              className={`${inputCls} pl-9`} />
            {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-600 hover:text-stone-300"><X size={13} /></button>}
          </div>
          <label className="flex items-center gap-2 text-[12px] text-stone-500 cursor-pointer select-none">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded border-stone-600" />
            Show inactive
          </label>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><div className="w-7 h-7 border-4 border-stone-700 border-t-emerald-500 rounded-full animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-stone-800 rounded-xl">
            <p className="text-stone-500 text-sm">
              {tabSource(tab).length === 0
                ? "Nothing here yet — sync your accounting system from Settings → Integrations, or create a record with the New button."
                : "No records match the current filter."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-stone-800">
            <table className={`${listTable} min-w-[640px]`}>
              {/* ── Chart of Accounts ── */}
              {tab === "accounts" && (
                <>
                  <thead className="bg-stone-900">
                    <tr className="border-b border-stone-800">
                      <th className={thCls}>Name</th><th className={thCls}>Code</th><th className={thCls}>Type</th><th className={thCls}>Detail type</th><th className={thCls}>Source</th><th className={`${thCls} text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountGroups.map(g => (
                      <Frag key={g.group}>
                        <tr className="bg-stone-900/70"><td colSpan={6} className="px-3 py-1.5 text-[11px] font-bold text-stone-400 uppercase tracking-wider">{g.group}</td></tr>
                        {g.rows.map(r => (
                          <tr key={r.id} className={`${listRow()} ${r.status === "Inactive" ? "opacity-45" : ""}`}>
                            <td className={`${listCell} text-stone-200 font-medium`} style={r.depth ? { paddingLeft: `${12 + r.depth * 20}px` } : undefined}>
                              {r.depth > 0 && <span className="text-stone-600 mr-1">└</span>}
                              {r.name}
                              {r.isSystem && <span className="ml-2 align-middle text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-stone-700/60 text-stone-300 border border-stone-600">System</span>}
                            </td>
                            <td className={`${listCell} text-stone-500 font-mono text-[12px]`}>{r.code ?? "—"}</td>
                            <td className={`${listCell} text-stone-400 text-[12px]`}>{r.type ?? "—"}</td>
                            <td className={`${listCell} text-stone-500 text-[12px]`}>{subtypeLabel(r.type, r.subtype) ?? "—"}</td>
                            <td className={listCell}>{sourceBadge(r.source)}</td>
                            <td className={`${listCell} text-right whitespace-nowrap`}>
                              <RowActions r={r} onEdit={() => openEdit(r)} onToggle={() => toggleStatus(r)} />
                            </td>
                          </tr>
                        ))}
                      </Frag>
                    ))}
                  </tbody>
                </>
              )}

              {/* ── Items ── */}
              {tab === "items" && (
                <>
                  <thead className="bg-stone-900">
                    <tr className="border-b border-stone-800">
                      <th className={thCls}>Name</th><th className={thCls}>Type</th><th className={thCls}>Code</th><th className={`${thCls} text-right`}>Sales price</th><th className={`${thCls} text-right`}>Cost</th><th className={thCls}>Income account</th><th className={thCls}>Source</th><th className={`${thCls} text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id} className={`${listRow()} ${r.status === "Inactive" ? "opacity-45" : ""}`}>
                        <td className={listCell}>
                          <div className="text-stone-200 font-medium">{r.name}</div>
                          {r.description && <div className="text-[11px] text-stone-600 max-w-[280px] truncate">{r.description}</div>}
                        </td>
                        <td className={`${listCell} text-stone-400 text-[12px]`}>{r.itemType ?? "Service"}</td>
                        <td className={`${listCell} text-stone-500 font-mono text-[12px]`}>{r.code ?? "—"}</td>
                        <td className={`${listNumCell} text-stone-300`}>{r.unitPrice != null ? fmt.num2(r.unitPrice) : "—"}</td>
                        <td className={`${listNumCell} text-stone-400`}>{r.unitCost != null ? fmt.num2(r.unitCost) : "—"}</td>
                        <td className={`${listCell} text-stone-500 text-[12px] max-w-[160px] truncate`}>{acctName(r.incomeAccountId)}</td>
                        <td className={listCell}>{sourceBadge(r.source)}</td>
                        <td className={`${listCell} text-right whitespace-nowrap`}>
                          <RowActions r={r} onEdit={() => openEdit(r)} onToggle={() => toggleStatus(r)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}

              {/* ── Classes / Locations / Cost Centres / Custom Fields — flat lists, one type per tab ── */}
              {(tab === "classes" || tab === "locations" || tab === "cost-centres" || tab === "custom-fields") && (
                <>
                  <thead className="bg-stone-900">
                    <tr className="border-b border-stone-800">
                      <th className={thCls}>Name</th><th className={thCls}>Code</th><th className={thCls}>Source</th><th className={`${thCls} text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rows].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")).map(r => (
                      <tr key={r.id} className={`${listRow()} ${r.status === "Inactive" ? "opacity-45" : ""}`}>
                        <td className={`${listCell} text-stone-200 font-medium`}>
                          {r.parentId && <span className="text-stone-600 mr-1">└</span>}
                          {r.name}
                        </td>
                        <td className={`${listCell} text-stone-500 font-mono text-[12px]`}>{r.code ?? "—"}</td>
                        <td className={listCell}>{sourceBadge(r.source)}</td>
                        <td className={`${listCell} text-right whitespace-nowrap`}>
                          <RowActions r={r} onEdit={() => openEdit(r)} onToggle={() => toggleStatus(r)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}

              {/* ── Other dimensions (tracking categories, cost centres…) ── */}
              {tab === "other-dims" && (
                <>
                  <thead className="bg-stone-900">
                    <tr className="border-b border-stone-800">
                      <th className={thCls}>Name</th><th className={thCls}>Code</th><th className={thCls}>Source</th><th className={`${thCls} text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dimensionGroups.map(g => (
                      <Frag key={g.type}>
                        <tr className="bg-stone-900/70"><td colSpan={4} className="px-3 py-1.5 text-[11px] font-bold text-stone-400 uppercase tracking-wider">{dimTypeLabel(g.type)} · {g.rows.length}</td></tr>
                        {g.rows.map(r => (
                          <tr key={r.id} className={`${listRow()} ${r.status === "Inactive" ? "opacity-45" : ""}`}>
                            <td className={`${listCell} text-stone-200 font-medium`}>
                              {r.parentId && <span className="text-stone-600 mr-1">└</span>}
                              {r.name}
                            </td>
                            <td className={`${listCell} text-stone-500 font-mono text-[12px]`}>{r.code ?? "—"}</td>
                            <td className={listCell}>{sourceBadge(r.source)}</td>
                            <td className={`${listCell} text-right whitespace-nowrap`}>
                              <RowActions r={r} onEdit={() => openEdit(r)} onToggle={() => toggleStatus(r)} />
                            </td>
                          </tr>
                        ))}
                      </Frag>
                    ))}
                  </tbody>
                </>
              )}

              {/* ── Tax rates ── */}
              {tab === "tax-rates" && (
                <>
                  <thead className="bg-stone-900">
                    <tr className="border-b border-stone-800">
                      <th className={thCls}>Name</th><th className={`${thCls} text-right`}>Rate</th><th className={thCls}>Type</th><th className={thCls}>Source</th><th className={`${thCls} text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id} className={`${listRow()} ${r.status === "Inactive" ? "opacity-45" : ""}`}>
                        <td className={`${listCell} text-stone-200 font-medium`}>{r.name}</td>
                        {/* A rate is a percentage, not money — .toFixed(2) here is
                            exempt from the money-formatting guard for that reason,
                            and is left exactly as it computed before this refactor. */}
                        <td className={`${listNumCell} text-stone-300`}>{r.rate != null ? `${Number(r.rate).toFixed(2)}%` : "—"}</td>
                        <td className={`${listCell} text-stone-500 text-[12px]`}>{r.taxType ?? "—"}</td>
                        <td className={listCell}>{sourceBadge(r.source)}</td>
                        <td className={`${listCell} text-right whitespace-nowrap`}>
                          <RowActions r={r} onEdit={() => openEdit(r)} onToggle={() => toggleStatus(r)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}
            </table>
          </div>
        )}
      </div>

      {/* ── Create / Edit modal ── */}
      {editRec !== null && (
        <Drawer
          title={`${editRec === "new" ? "New" : "Edit"} ${tab === "accounts" ? "account" : tab === "items" ? "item" : tab === "tax-rates" ? "tax rate" : tab === "classes" ? "class" : tab === "locations" ? "location" : tab === "cost-centres" ? "cost centre" : tab === "custom-fields" ? "custom field" : "dimension"}`}
          subtitle={isSyncedEdit
            ? <span className="flex items-center gap-1 text-amber-400"><Lock size={11} /> Synced — read-only</span>
            : undefined}
          onClose={() => { if (!saving) setEditRec(null); }}
          footer={
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setEditRec(null)} disabled={saving} className="text-[13px] text-stone-400 hover:text-white px-3 py-2">Cancel</button>
              {!isSyncedEdit && (
                <button onClick={save} disabled={saving || !(form.name ?? "").trim() || (tab === "tax-rates" && form.rate === "")}
                  className="text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-4 py-2 disabled:opacity-40 hover:bg-emerald-700 transition-colors">
                  {saving ? "Saving…" : editRec === "new" ? "Create" : "Save changes"}
                </button>
              )}
            </div>
          }
        >
            <div className="space-y-4">
              {errMsg && <div className="text-[12px] text-rose-400 bg-rose-950/40 border border-rose-900 rounded-lg px-3 py-2">{errMsg}</div>}

              <div>
                <label className={labelCls}>Name *</label>
                <input value={form.name ?? ""} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} disabled={!!isSyncedEdit} className={inputCls} autoFocus />
              </div>

              {tab === "accounts" && (
                <>
                  <div>
                    <label className={labelCls}>Account type *</label>
                    <select value={form.type ?? ""} onChange={e => setForm(p => ({ ...p, type: e.target.value, subtype: "", parentId: "" }))} disabled={!!isSyncedEdit} className={inputCls}>
                      {TYPE_GROUPS.map(([group, types]) => (
                        <optgroup key={group} label={group}>
                          {types.map(t => <option key={t} value={t}>{t}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Detail type</label>
                    <select value={form.subtype ?? ""} onChange={e => setForm(p => ({ ...p, subtype: e.target.value }))} disabled={!!isSyncedEdit} className={inputCls}>
                      <option value="">—</option>
                      {(QBO_ACCOUNT_SUBTYPES[form.type] ?? []).map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Account code</label>
                    <input value={form.code ?? ""} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} disabled={!!isSyncedEdit} placeholder="e.g. 6100" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Parent account</label>
                    <select value={form.parentId ?? ""} onChange={e => setForm(p => ({ ...p, parentId: e.target.value }))} disabled={!!isSyncedEdit} className={inputCls}>
                      <option value="">— (top-level account)</option>
                      {data["accounts"]
                        .filter(a => a.type === form.type && a.status !== "Inactive" && a.id !== (editRec as Rec)?.id)
                        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
                        // accounts.parent_id is always our internal id, whether
                        // set here or resolved by the QBO sync (see
                        // lib/qbo-ap-sync.ts / lib/accounting/account-parent.ts).
                        .map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ""}{a.name}</option>)}
                    </select>
                    <p className="text-[11px] text-stone-500 mt-1">Makes this a sub-account. Only accounts of the same account type can be picked as a parent.</p>
                  </div>
                  {mcEnabled && form.type === "Bank" && (
                    <div>
                      <label className={labelCls}>Currency</label>
                      <select value={form.currency ?? ""} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))} disabled={!!isSyncedEdit} className={inputCls}>
                        <option value="">— (defaults to {homeCcy || "home currency"})</option>
                        {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}{c.code === homeCcy ? " (home)" : ""}</option>)}
                      </select>
                      <p className="text-[11px] text-stone-500 mt-1">Informational only — which currency this account is held in. New transactions through it default to this currency; the ledger itself always stays in {homeCcy || "the home currency"}.</p>
                    </div>
                  )}
                </>
              )}

              {tab === "items" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Type</label>
                      <select value={form.itemType ?? "Service"} onChange={e => setForm(p => ({ ...p, itemType: e.target.value }))} disabled={!!isSyncedEdit} className={inputCls}>
                        {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Code / SKU</label>
                      <input value={form.code ?? ""} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} disabled={!!isSyncedEdit} className={inputCls} />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Description</label>
                    <textarea value={form.description ?? ""} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} disabled={!!isSyncedEdit} rows={2} className={`${inputCls} resize-none`} />
                  </div>
                  <div className="border-t border-stone-800 pt-3">
                    <div className="text-[11px] font-bold text-stone-500 uppercase tracking-wider mb-2">Sales</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Sales price</label>
                        <input type="number" step="0.01" value={form.unitPrice ?? ""} onChange={e => setForm(p => ({ ...p, unitPrice: e.target.value }))} disabled={!!isSyncedEdit} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Income account</label>
                        <select value={form.incomeAccountId ?? ""} onChange={e => setForm(p => ({ ...p, incomeAccountId: e.target.value }))} disabled={!!isSyncedEdit} className={inputCls}>
                          <option value="">—</option>
                          {incomeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-stone-800 pt-3">
                    <div className="text-[11px] font-bold text-stone-500 uppercase tracking-wider mb-2">Purchasing</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Cost</label>
                        <input type="number" step="0.01" value={form.unitCost ?? ""} onChange={e => setForm(p => ({ ...p, unitCost: e.target.value }))} disabled={!!isSyncedEdit} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Expense account</label>
                        <select value={form.expenseAccountId ?? ""} onChange={e => setForm(p => ({ ...p, expenseAccountId: e.target.value }))} disabled={!!isSyncedEdit} className={inputCls}>
                          <option value="">—</option>
                          {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Tax rate</label>
                    <select value={form.taxRateId ?? ""} onChange={e => setForm(p => ({ ...p, taxRateId: e.target.value }))} disabled={!!isSyncedEdit} className={inputCls}>
                      <option value="">—</option>
                      {taxRates.map(t => <option key={t.id} value={t.id}>{t.name}{t.rate != null ? ` (${Number(t.rate).toFixed(1)}%)` : ""}</option>)}
                    </select>
                  </div>
                </>
              )}

              {(tab === "classes" || tab === "locations" || tab === "cost-centres" || tab === "custom-fields" || tab === "other-dims") && (
                <div>
                  <label className={labelCls}>Code</label>
                  <input value={form.code ?? ""} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} disabled={!!isSyncedEdit} className={inputCls} />
                  {tab === "custom-fields" && (
                    <p className="text-[11px] text-stone-600 mt-1.5">Custom fields defined here will appear on native invoice and bill forms in a later phase — the value is entered per transaction, like QuickBooks.</p>
                  )}
                </div>
              )}

              {tab === "tax-rates" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Rate (%) *</label>
                      <input type="number" step="0.01" min="0" max="100" value={form.rate ?? ""} onChange={e => setForm(p => ({ ...p, rate: e.target.value }))} disabled={!!isSyncedEdit} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Type</label>
                      <input value={form.taxType ?? ""} onChange={e => setForm(p => ({ ...p, taxType: e.target.value }))} disabled={!!isSyncedEdit} placeholder="e.g. VAT, Sales" className={inputCls} />
                    </div>
                  </div>
                </>
              )}
            </div>
        </Drawer>
      )}
    </div>
  );
}

function RowActions({ r, onEdit, onToggle }: { r: any; onEdit: () => void; onToggle: () => void }) {
  const native = r.source === "native";
  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={onEdit} title={native ? "Edit" : "View (synced — read-only)"}
        className="text-stone-500 hover:text-stone-200">
        {native ? <Pencil size={13} /> : <Lock size={12} />}
      </button>
      {r.isSystem ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-stone-600" title="System account — required by the books, can't be removed">
          <Lock size={11} /> Protected
        </span>
      ) : (
        <button onClick={onToggle}
          className={`text-[11px] font-medium ${r.status === "Inactive" ? "text-emerald-500 hover:text-emerald-400" : "text-stone-600 hover:text-rose-400"}`}>
          {r.status === "Inactive" ? "Activate" : "Deactivate"}
        </button>
      )}
    </span>
  );
}

function Frag({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// Default page export (used at /settings/accounting and re-exported at /accounting).
export default function AccountingSettingsPage() {
  return <AccountingLists />;
}
