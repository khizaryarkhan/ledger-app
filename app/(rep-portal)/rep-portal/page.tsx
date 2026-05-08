"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession, signOut } from "next-auth/react";
import { fmt, formatDate, daysOverdue } from "@/lib/format";
import {
  LogOut, RefreshCw, AlertCircle, ChevronLeft, ChevronRight,
  Download, Loader, ChevronDown, ChevronUp, FileText, Search, X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Invoice = {
  id: string; invoiceNumber: string; customerId: string; projectId: string | null;
  invoiceDate: string; dueDate: string; total: number; paid: number; currency: string;
  paymentStatus: string; collectionStage: string; billingEmail: string | null;
  qboId: string | null;
};
type Customer    = { id: string; name: string; code: string; currency: string; };
type Project     = { id: string; name: string; code: string; customerId: string; };
type OrgSettings = { classificationLevel: string; dateFormat: string; };

// ─── Aging helpers ────────────────────────────────────────────────────────────
const AGING = [
  { key: "current", label: "Current", bar: "bg-emerald-500", dot: "bg-emerald-500" },
  { key: "d30",     label: "1–30d",   bar: "bg-amber-400",   dot: "bg-amber-400"   },
  { key: "d60",     label: "31–60d",  bar: "bg-orange-500",  dot: "bg-orange-500"  },
  { key: "d90",     label: "61–90d",  bar: "bg-rose-500",    dot: "bg-rose-500"    },
  { key: "d90plus", label: "90+d",    bar: "bg-rose-800",    dot: "bg-rose-800"    },
] as const;
type AgingKey = "current" | "d30" | "d60" | "d90" | "d90plus" | "total";

function getAgingBuckets(invs: Invoice[]) {
  const b = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0 };
  for (const inv of invs) {
    if (["Paid", "Written Off"].includes(inv.paymentStatus) || inv.collectionStage === "Closed") continue;
    const out = inv.total - (inv.paid || 0);
    const d = daysOverdue(inv.dueDate);
    b.total += out;
    if (d <= 0)       b.current += out;
    else if (d <= 30) b.d30     += out;
    else if (d <= 60) b.d60     += out;
    else if (d <= 90) b.d90     += out;
    else              b.d90plus += out;
  }
  return b;
}

function AgingBar({ buckets }: { buckets: ReturnType<typeof getAgingBuckets> }) {
  if (buckets.total === 0) return null;
  return (
    <div className="mt-3">
      <div className="flex h-2 rounded-full overflow-hidden gap-[1px]">
        {AGING.map(({ key, bar }) => {
          const pct = (buckets[key as AgingKey] as number) / buckets.total * 100;
          if (pct < 0.5) return null;
          return <div key={key} className={`${bar} h-full`} style={{ width: `${pct}%` }} />;
        })}
      </div>
      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
        {AGING.map(({ key, dot, label }) => {
          const pct = (buckets[key as AgingKey] as number) / buckets.total * 100;
          if (pct < 0.5) return null;
          return (
            <div key={key} className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
              <span className="text-[10px] text-stone-400">{label} <span className="font-semibold text-stone-600">{pct.toFixed(0)}%</span></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Badge colours ────────────────────────────────────────────────────────────
const STAGE_COLORS: Record<string, string> = {
  "New": "bg-stone-100 text-stone-600", "Scheduled": "bg-blue-100 text-blue-700",
  "Reminder Sent": "bg-blue-200 text-blue-800", "Second Notice": "bg-violet-100 text-violet-700",
  "Final Notice": "bg-violet-200 text-violet-800", "Awaiting": "bg-amber-100 text-amber-700",
  "Promised": "bg-amber-100 text-amber-800", "Disputed": "bg-rose-100 text-rose-700",
  "Escalated": "bg-rose-200 text-rose-800", "On Hold": "bg-orange-100 text-orange-700",
  "Closed": "bg-emerald-100 text-emerald-700",
};
const STATUS_COLORS: Record<string, string> = {
  "Overdue": "bg-rose-100 text-rose-700", "Due Today": "bg-amber-100 text-amber-700",
  "Due Soon": "bg-yellow-100 text-yellow-700", "Not Due": "bg-stone-100 text-stone-500",
  "Paid": "bg-emerald-100 text-emerald-700", "Written Off": "bg-stone-100 text-stone-400",
};

function getDueStatus(inv: Invoice): string {
  if (["Paid", "Written Off"].includes(inv.paymentStatus)) return inv.paymentStatus;
  const d = daysOverdue(inv.dueDate);
  if (d > 0)  return "Overdue";
  if (d === 0) return "Due Today";
  if (d >= -7) return "Due Soon";
  return "Not Due";
}

// ─── Entity Card (Customer or Project) ───────────────────────────────────────
function EntityCard({ entity, invoices, customerName, onClick }: {
  entity: Customer | Project; invoices: Invoice[];
  customerName?: string; onClick: () => void;
}) {
  const open = invoices.filter(i =>
    !["Paid", "Written Off"].includes(i.paymentStatus) && i.collectionStage !== "Closed"
  );
  const outstanding = open.reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
  const buckets     = getAgingBuckets(invoices);
  const hasOverdue  = open.some(i => daysOverdue(i.dueDate) > 0);

  const stageCounts: Record<string, number> = {};
  open.forEach(i => { stageCounts[i.collectionStage] = (stageCounts[i.collectionStage] || 0) + 1; });
  const dominantStage = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "New";

  return (
    <button onClick={onClick}
      className="w-full text-left bg-white rounded-xl ring-1 ring-stone-200 p-4 hover:ring-stone-400 hover:shadow-sm transition-all active:scale-[0.99]">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-stone-400 font-mono mb-0.5">{(entity as any).code}</div>
          <div className="text-sm font-semibold text-stone-900 leading-snug">{entity.name}</div>
          {customerName && <div className="text-[11px] text-stone-400 mt-0.5">{customerName}</div>}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-3 mt-0.5">
          {hasOverdue && <div className="w-2 h-2 rounded-full bg-rose-500" />}
          <ChevronRight size={14} className="text-stone-300" />
        </div>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="text-xl font-bold tabular-nums text-stone-900">
          {fmt.money(outstanding, (entity as any).currency)}
        </div>
        <div className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${STAGE_COLORS[dominantStage] || STAGE_COLORS["New"]}`}>
          {dominantStage}
        </div>
      </div>

      <div className="text-[11px] text-stone-400 mt-1">
        {open.length} open invoice{open.length !== 1 ? "s" : ""}
        {invoices.length > open.length && ` · ${invoices.length - open.length} closed`}
      </div>

      <AgingBar buckets={buckets} />
    </button>
  );
}

// ─── Invoice Row ──────────────────────────────────────────────────────────────
function InvoiceRow({ inv, df, onDownload, downloading }: {
  inv: Invoice; df: string;
  onDownload: (inv: Invoice) => void; downloading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isPaidOrClosed = ["Paid", "Written Off"].includes(inv.paymentStatus) || inv.collectionStage === "Closed";
  const outstanding    = isPaidOrClosed ? 0 : inv.total - (inv.paid || 0);
  const dueStatus      = getDueStatus(inv);
  const overdue        = daysOverdue(inv.dueDate);
  const canDownload    = !!inv.qboId && !inv.qboId.startsWith("CM-") && !isPaidOrClosed;

  return (
    <div className="bg-white rounded-xl ring-1 ring-stone-200 overflow-hidden">
      <button className="w-full text-left px-4 py-3" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[12px] font-semibold text-stone-500">{inv.invoiceNumber}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${STATUS_COLORS[dueStatus] || "bg-stone-100 text-stone-500"}`}>
                {dueStatus}
              </span>
            </div>
            <div className="text-[11px] text-stone-400 mt-0.5">
              Due {formatDate(inv.dueDate, df)}
              {overdue > 0 && <span className="text-rose-500 font-semibold ml-1">+{overdue}d</span>}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className={`text-base font-bold tabular-nums ${isPaidOrClosed ? "text-stone-300" : overdue > 0 ? "text-rose-600" : "text-stone-900"}`}>
              {fmt.money(outstanding, inv.currency)}
            </div>
            {expanded
              ? <ChevronUp size={13} className="mt-0.5 ml-auto text-stone-300" />
              : <ChevronDown size={13} className="mt-0.5 ml-auto text-stone-300" />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-stone-100 px-4 py-3 bg-stone-50/50 space-y-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
            <div>
              <div className="text-[10px] text-stone-400 uppercase tracking-wide mb-0.5">Invoice date</div>
              <div className="font-medium text-stone-700">{formatDate(inv.invoiceDate, df)}</div>
            </div>
            <div>
              <div className="text-[10px] text-stone-400 uppercase tracking-wide mb-0.5">Due date</div>
              <div className={`font-medium ${overdue > 0 ? "text-rose-600" : "text-stone-700"}`}>{formatDate(inv.dueDate, df)}</div>
            </div>
            <div>
              <div className="text-[10px] text-stone-400 uppercase tracking-wide mb-0.5">Invoice total</div>
              <div className="font-semibold text-stone-900 tabular-nums">{fmt.money(inv.total, inv.currency)}</div>
            </div>
            <div>
              <div className="text-[10px] text-stone-400 uppercase tracking-wide mb-0.5">Paid</div>
              <div className="font-semibold text-emerald-600 tabular-nums">{fmt.money(inv.paid || 0, inv.currency)}</div>
            </div>
            <div>
              <div className="text-[10px] text-stone-400 uppercase tracking-wide mb-0.5">Stage</div>
              <div className={`inline-flex text-[10px] px-1.5 py-0.5 rounded font-semibold ${STAGE_COLORS[inv.collectionStage] || STAGE_COLORS["New"]}`}>
                {inv.collectionStage}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-stone-400 uppercase tracking-wide mb-0.5">Status</div>
              <div className="font-medium text-stone-700">{inv.paymentStatus}</div>
            </div>
          </div>

          {canDownload && (
            <button
              onClick={() => onDownload(inv)}
              disabled={downloading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-stone-900 text-white text-sm font-medium active:bg-stone-700 disabled:opacity-50 transition-colors">
              {downloading
                ? <><Loader size={14} className="animate-spin" /> Preparing PDF…</>
                : <><Download size={14} /> Download Invoice PDF</>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type View = { type: "home" } | { type: "entity"; id: string; kind: "customer" | "project" };

export default function RepPortalPage() {
  const { data: session } = useSession();
  const [invoices,    setInvoices]    = useState<Invoice[]>([]);
  const [customers,   setCustomers]   = useState<Customer[]>([]);
  const [projects,    setProjects]    = useState<Project[]>([]);
  const [orgSettings, setOrgSettings] = useState<OrgSettings>({ classificationLevel: "customer", dateFormat: "DD MMM YYYY" });
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState("");
  const [view,        setView]        = useState<View>({ type: "home" });
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [homeSearch, setHomeSearch]   = useState("");

  const repName = session?.user?.name || "Rep";
  const level   = orgSettings.classificationLevel as "customer" | "project";
  const df      = orgSettings.dateFormat || "DD MMM YYYY";

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [invRes, custRes, projRes, settingsRes] = await Promise.all([
        fetch("/api/invoices"),
        fetch("/api/customers"),
        fetch("/api/projects"),
        fetch("/api/org/settings"),
      ]);
      if (invRes.ok)      setInvoices(await invRes.json());
      else                setError("Failed to load data");
      if (custRes.ok)     setCustomers(await custRes.json());
      if (projRes.ok)     setProjects(await projRes.json());
      if (settingsRes.ok) setOrgSettings(await settingsRes.json());
    } catch { setError("Network error — please refresh"); }
    finally  { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleDownload = async (inv: Invoice) => {
    setDownloadingId(inv.id);
    try {
      const res = await fetch(`/api/invoices/${inv.id}/pdf`);
      if (!res.ok) { alert("PDF not available"); return; }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `Invoice-${inv.invoiceNumber}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { alert("Failed to download PDF"); }
    finally { setDownloadingId(null); }
  };

  // ── Summary stats ────────────────────────────────────────────────────────────
  const openInvoices = useMemo(() =>
    invoices.filter(i => !["Paid","Written Off"].includes(i.paymentStatus) && i.collectionStage !== "Closed"),
    [invoices]
  );
  const totalAR      = openInvoices.reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
  const overdueAR    = openInvoices.filter(i => daysOverdue(i.dueDate) > 0).reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
  const overdueCnt   = openInvoices.filter(i => daysOverdue(i.dueDate) > 0).length;
  const globalBuckets = useMemo(() => getAgingBuckets(invoices), [invoices]);

  // ── Entity list ──────────────────────────────────────────────────────────────
  const entityList = useMemo(() => {
    const byOutstanding = (invs: Invoice[]) =>
      invs.filter(i => !["Paid","Written Off"].includes(i.paymentStatus)).reduce((s, i) => s + (i.total - (i.paid || 0)), 0);

    if (level === "customer") {
      return customers
        .map(c => ({ entity: c as Customer | Project, invoices: invoices.filter(i => i.customerId === c.id), customer: undefined as Customer | undefined }))
        .filter(x => x.invoices.length > 0)
        .sort((a, b) => byOutstanding(b.invoices) - byOutstanding(a.invoices));
    }
    return projects
      .map(p => ({
        entity: p as Customer | Project,
        invoices: invoices.filter(i => i.projectId === p.id),
        customer: customers.find(c => c.id === p.customerId),
      }))
      .filter(x => x.invoices.length > 0)
      .sort((a, b) => byOutstanding(b.invoices) - byOutstanding(a.invoices));
  }, [customers, projects, invoices, level]);

  // ── Detail view data ─────────────────────────────────────────────────────────
  const detailData = useMemo(() => {
    if (view.type !== "entity") return null;
    const entityInvoices = view.kind === "customer"
      ? invoices.filter(i => i.customerId === view.id)
      : invoices.filter(i => i.projectId  === view.id);
    const entity       = view.kind === "customer" ? customers.find(c => c.id === view.id) : projects.find(p => p.id === view.id);
    const customerName = view.kind === "project"  ? customers.find(c => c.id === (entity as Project)?.customerId)?.name : undefined;
    const open         = entityInvoices.filter(i => !["Paid","Written Off"].includes(i.paymentStatus) && i.collectionStage !== "Closed");
    const outstanding  = open.reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
    const buckets      = getAgingBuckets(entityInvoices);
    return { entity, entityInvoices, customerName, outstanding, buckets, openCount: open.length };
  }, [view, invoices, customers, projects]);

  // ═══ RENDER ══════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-stone-50 pb-10">

      {/* Sticky header */}
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-20">
        {view.type === "entity" ? (
          <button onClick={() => setView({ type: "home" })}
            className="p-1.5 -ml-1.5 rounded-lg hover:bg-stone-100 text-stone-700">
            <ChevronLeft size={20} />
          </button>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-stone-900 flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0 select-none">
            AR
          </div>
        )}

        <div className="flex-1 min-w-0">
          {view.type === "home" ? (
            <>
              <div className="text-[10px] uppercase tracking-widest text-stone-400 font-semibold leading-none">Ledger AR</div>
              <div className="text-base font-semibold text-stone-900 leading-tight mt-0.5">Hi, {repName.split(" ")[0]} 👋</div>
            </>
          ) : (
            <>
              <div className="text-[10px] uppercase tracking-widest text-stone-400 font-semibold leading-none">
                {view.kind === "customer" ? "Customer" : "Project"}
              </div>
              <div className="text-sm font-semibold text-stone-900 truncate mt-0.5">{detailData?.entity?.name}</div>
            </>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-100 text-stone-400">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="p-2 rounded-lg hover:bg-stone-100 text-stone-400">
            <LogOut size={15} />
          </button>
        </div>
      </div>

      <div className="px-4 pt-4 max-w-lg mx-auto">

        {/* Error */}
        {error && (
          <div className="mb-4 flex items-center gap-2 bg-rose-50 ring-1 ring-rose-200 rounded-xl p-3 text-sm text-rose-700">
            <AlertCircle size={15} className="flex-shrink-0" /> {error}
          </div>
        )}

        {/* ══════════ HOME ══════════ */}
        {view.type === "home" && (
          <>
            {/* Summary banner */}
            {!loading && (
              <div className="bg-white rounded-xl ring-1 ring-stone-200 p-4 mb-4">
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-0.5">Total AR</div>
                    <div className="text-xl font-bold text-stone-900 tabular-nums leading-tight">{fmt.money(totalAR)}</div>
                    <div className="text-[10px] text-stone-400 mt-0.5">{openInvoices.length} open</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-0.5">Overdue</div>
                    <div className={`text-xl font-bold tabular-nums leading-tight ${overdueAR > 0 ? "text-rose-600" : "text-stone-900"}`}>{fmt.money(overdueAR)}</div>
                    <div className="text-[10px] text-stone-400 mt-0.5">{overdueCnt} invoice{overdueCnt !== 1 ? "s" : ""}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-0.5">
                      {level === "customer" ? "Customers" : "Projects"}
                    </div>
                    <div className="text-xl font-bold text-stone-900 leading-tight">{entityList.length}</div>
                    <div className="text-[10px] text-stone-400 mt-0.5">with AR</div>
                  </div>
                </div>
                <AgingBar buckets={globalBuckets} />
              </div>
            )}

            {/* Search bar */}
            {!loading && entityList.length > 0 && (
              <div className="relative mb-3">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                <input
                  value={homeSearch}
                  onChange={e => setHomeSearch(e.target.value)}
                  placeholder={`Search ${level === "customer" ? "customers" : "projects"}…`}
                  className="w-full h-10 pl-9 pr-9 text-sm rounded-xl ring-1 ring-stone-200 bg-white focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
                {homeSearch && (
                  <button onClick={() => setHomeSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700">
                    <X size={14} />
                  </button>
                )}
              </div>
            )}

            {/* Entity cards */}
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map(n => (
                  <div key={n} className="bg-white rounded-xl ring-1 ring-stone-200 p-4 animate-pulse">
                    <div className="h-2.5 bg-stone-100 rounded w-16 mb-2" />
                    <div className="h-4 bg-stone-100 rounded w-40 mb-3" />
                    <div className="h-6 bg-stone-100 rounded w-28" />
                  </div>
                ))}
              </div>
            ) : entityList.length === 0 ? (
              <div className="text-center py-16 text-stone-400">
                <FileText size={32} className="mx-auto mb-2 opacity-30" />
                <div className="text-sm">No receivables assigned yet</div>
              </div>
            ) : (() => {
              const s = homeSearch.toLowerCase();
              const visible = homeSearch
                ? entityList.filter(({ entity, customer }) =>
                    entity.name?.toLowerCase().includes(s) ||
                    (entity as any).code?.toLowerCase().includes(s) ||
                    customer?.name?.toLowerCase().includes(s)
                  )
                : entityList;
              return visible.length === 0 ? (
                <div className="text-center py-12 text-stone-400">
                  <Search size={24} className="mx-auto mb-2 opacity-30" />
                  <div className="text-sm">No results for "{homeSearch}"</div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {visible.map(({ entity, invoices: eInvs, customer }) => (
                    <EntityCard
                      key={entity.id}
                      entity={entity}
                      invoices={eInvs}
                      customerName={customer?.name}
                      onClick={() => setView({ type: "entity", id: entity.id, kind: level })}
                    />
                  ))}
                </div>
              );
            })()}
          </>
        )}

        {/* ══════════ DETAIL ══════════ */}
        {view.type === "entity" && detailData && (
          <>
            {/* Entity summary */}
            <div className="bg-white rounded-xl ring-1 ring-stone-200 p-4 mb-4">
              {detailData.customerName && (
                <div className="text-[11px] text-stone-400 mb-1">{detailData.customerName}</div>
              )}
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-0.5">Outstanding</div>
                  <div className="text-2xl font-bold tabular-nums text-stone-900">{fmt.money(detailData.outstanding)}</div>
                </div>
                <div className="text-right text-[12px] text-stone-500 pb-0.5">
                  <div>{detailData.openCount} open</div>
                  <div>{detailData.entityInvoices.length} total</div>
                </div>
              </div>
              <AgingBar buckets={detailData.buckets} />
            </div>

            {/* Invoices */}
            {detailData.entityInvoices.length === 0 ? (
              <div className="text-center py-12 text-stone-400">
                <FileText size={28} className="mx-auto mb-2 opacity-30" />
                <div className="text-sm">No invoices</div>
              </div>
            ) : (
              <div className="space-y-2">
                {[...detailData.entityInvoices]
                  .sort((a, b) => {
                    const aOpen = !["Paid","Written Off"].includes(a.paymentStatus);
                    const bOpen = !["Paid","Written Off"].includes(b.paymentStatus);
                    if (aOpen !== bOpen) return aOpen ? -1 : 1;
                    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
                  })
                  .map(inv => (
                    <InvoiceRow
                      key={inv.id}
                      inv={inv}
                      df={df}
                      onDownload={handleDownload}
                      downloading={downloadingId === inv.id}
                    />
                  ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
