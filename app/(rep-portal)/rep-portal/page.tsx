"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession, signOut } from "next-auth/react";
import { fmt, formatDate, daysOverdue } from "@/lib/format";
import {
  LogOut, RefreshCw, AlertCircle, ChevronLeft, Download, Loader,
  ChevronDown, ChevronUp, FileText, TrendingUp, Clock, AlertTriangle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Invoice = {
  id: string; invoiceNumber: string; customerId: string; projectId: string | null;
  invoiceDate: string; dueDate: string; total: number; paid: number; currency: string;
  paymentStatus: string; collectionStage: string; billingEmail: string | null;
  qboId: string | null;
};
type Customer = { id: string; name: string; code: string; currency: string; };
type Project  = { id: string; name: string; code: string; customerId: string; };
type OrgSettings = { classificationLevel: string; dateFormat: string; };

// ─── Aging helpers (same palette as the Collection Board) ─────────────────────
const AGING = [
  { key: "current", label: "Current", color: "bg-emerald-500", dot: "bg-emerald-500" },
  { key: "d30",     label: "1–30d",   color: "bg-amber-400",   dot: "bg-amber-400"   },
  { key: "d60",     label: "31–60d",  color: "bg-orange-500",  dot: "bg-orange-500"  },
  { key: "d90",     label: "61–90d",  color: "bg-rose-500",    dot: "bg-rose-500"    },
  { key: "d90plus", label: "90+d",    color: "bg-rose-800",    dot: "bg-rose-800"    },
] as const;
type AgingKey = "current" | "d30" | "d60" | "d90" | "d90plus" | "total";

function getAgingBuckets(invs: Invoice[]) {
  const b = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0 };
  for (const inv of invs) {
    const isPaidClosed = ["Paid", "Written Off"].includes(inv.paymentStatus) || inv.collectionStage === "Closed";
    if (isPaidClosed) continue;
    const out = inv.total - (inv.paid || 0);
    const d = daysOverdue(inv.dueDate);
    b.total += out;
    if (d <= 0)       b.current  += out;
    else if (d <= 30) b.d30      += out;
    else if (d <= 60) b.d60      += out;
    else if (d <= 90) b.d90      += out;
    else              b.d90plus  += out;
  }
  return b;
}

function AgingBar({ buckets }: { buckets: ReturnType<typeof getAgingBuckets> }) {
  if (buckets.total === 0) return null;
  return (
    <div className="mt-3">
      <div className="flex h-2 rounded-full overflow-hidden gap-[1px]">
        {AGING.map(({ key, color }) => {
          const pct = buckets.total > 0 ? (buckets[key as AgingKey] as number) / buckets.total * 100 : 0;
          if (pct < 0.5) return null;
          return <div key={key} className={`${color} h-full rounded-sm`} style={{ width: `${pct}%` }} />;
        })}
      </div>
      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
        {AGING.map(({ key, dot, label }) => {
          const val = buckets[key as AgingKey] as number;
          const pct = buckets.total > 0 ? val / buckets.total * 100 : 0;
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

// ─── Stage badge colours ───────────────────────────────────────────────────────
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
  const isPaid = ["Paid", "Written Off"].includes(inv.paymentStatus);
  if (isPaid) return inv.paymentStatus;
  const d = daysOverdue(inv.dueDate);
  if (d > 0) return "Overdue";
  if (d === 0) return "Due Today";
  if (d >= -7) return "Due Soon";
  return "Not Due";
}

// ─── Entity Card (Customer or Project) ────────────────────────────────────────
function EntityCard({ entity, invoices, customerName, onClick }: {
  entity: Customer | Project; invoices: Invoice[];
  customerName?: string; onClick: () => void;
}) {
  const open = invoices.filter(i =>
    !["Paid", "Written Off"].includes(i.paymentStatus) && i.collectionStage !== "Closed"
  );
  const outstanding = open.reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
  const buckets = getAgingBuckets(invoices);
  const hasOverdue = open.some(i => daysOverdue(i.dueDate) > 0);

  // Dominant stage
  const stageCounts: Record<string, number> = {};
  open.forEach(i => { stageCounts[i.collectionStage] = (stageCounts[i.collectionStage] || 0) + 1; });
  const dominantStage = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "New";

  return (
    <button onClick={onClick} className="w-full text-left bg-white rounded-xl ring-1 ring-stone-200 p-4 hover:ring-stone-400 hover:shadow-sm transition-all active:scale-[0.99]">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-stone-400 font-mono mb-0.5">{(entity as any).code}</div>
          <div className="text-sm font-semibold text-stone-900 leading-tight">{entity.name}</div>
          {customerName && (
            <div className="text-[11px] text-stone-400 mt-0.5">{customerName}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
          {hasOverdue && <div className="w-2 h-2 rounded-full bg-rose-500" />}
          <ChevronRight size={14} className="text-stone-300" />
        </div>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="text-lg font-bold tabular-nums text-stone-900">
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

function ChevronRight({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

// ─── Invoice Row (inside detail view) ─────────────────────────────────────────
function InvoiceRow({ inv, df, onDownload, downloading }: {
  inv: Invoice; df: string; onDownload: (inv: Invoice) => void; downloading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isPaidOrClosed = ["Paid", "Written Off"].includes(inv.paymentStatus) || inv.collectionStage === "Closed";
  const outstanding = isPaidOrClosed ? 0 : inv.total - (inv.paid || 0);
  const dueStatus = getDueStatus(inv);
  const overdue = daysOverdue(inv.dueDate);
  const canDownload = !!inv.qboId && !inv.qboId.startsWith("CM-") && !isPaidOrClosed;

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
            <div className={`text-base font-bold tabular-nums ${isPaidOrClosed ? "text-stone-300" : outstanding > 0 && overdue > 0 ? "text-rose-600" : "text-stone-900"}`}>
              {fmt.money(outstanding, inv.currency)}
            </div>
            {expanded ? <ChevronUp size={13} className="mt-0.5 ml-auto text-stone-300" /> : <ChevronDown size={13} className="mt-0.5 ml-auto text-stone-300" />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-stone-100 px-4 py-3 bg-stone-50/50 space-y-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
            <div><div className="text-stone-400 text-[10px] uppercase tracking-wide mb-0.5">Invoice date</div><div className="font-medium text-stone-700">{formatDate(inv.invoiceDate, df)}</div></div>
            <div><div className="text-stone-400 text-[10px] uppercase tracking-wide mb-0.5">Due date</div><div className={`font-medium ${overdue > 0 ? "text-rose-600" : "text-stone-700"}`}>{formatDate(inv.dueDate, df)}</div></div>
            <div><div className="text-stone-400 text-[10px] uppercase tracking-wide mb-0.5">Invoice total</div><div className="font-semibold text-stone-900 tabular-nums">{fmt.money(inv.total, inv.currency)}</div></div>
            <div><div className="text-stone-400 text-[10px] uppercase tracking-wide mb-0.5">Paid</div><div className="font-semibold text-emerald-600 tabular-nums">{fmt.money(inv.paid || 0, inv.currency)}</div></div>
            <div><div className="text-stone-400 text-[10px] uppercase tracking-wide mb-0.5">Stage</div><div className={`inline-flex text-[10px] px-1.5 py-0.5 rounded font-semibold ${STAGE_COLORS[inv.collectionStage] || STAGE_COLORS["New"]}`}>{inv.collectionStage}</div></div>
            <div><div className="text-stone-400 text-[10px] uppercase tracking-wide mb-0.5">Status</div><div className="font-medium text-stone-700">{inv.paymentStatus}</div></div>
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

// ─── Main Page ─────────────────────────────────────────────────────────────────
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

  const repName = session?.user?.name || "Rep";
  const level = orgSettings.classificationLevel as "customer" | "project";
  const df = orgSettings.dateFormat || "DD MMM YYYY";

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
      else { setError("Failed to load data"); }
      if (custRes.ok)     setCustomers(await custRes.json());
      if (projRes.ok)     setProjects(await projRes.json());
      if (settingsRes.ok) setOrgSettings(await settingsRes.json());
    } catch { setError("Network error — please refresh"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // ── Download PDF ────────────────────────────────────────────────────────────
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

  // ── Summary stats (always from full set) ────────────────────────────────────
  const openInvoices = useMemo(() =>
    invoices.filter(i => !["Paid", "Written Off"].includes(i.paymentStatus) && i.collectionStage !== "Closed"),
    [invoices]
  );
  const totalAR    = openInvoices.reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
  const overdueAR  = openInvoices.filter(i => daysOverdue(i.dueDate) > 0).reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
  const overdueCnt = openInvoices.filter(i => daysOverdue(i.dueDate) > 0).length;
  const globalBuckets = useMemo(() => getAgingBuckets(invoices), [invoices]);

  // ── Entity list (customers or projects) ─────────────────────────────────────
  const entityList = useMemo(() => {
    if (level === "customer") {
      return customers
        .map(c => ({
          entity: c,
          invoices: invoices.filter(i => i.customerId === c.id),
        }))
        .filter(x => x.invoices.length > 0)
        .sort((a, b) => {
          const ao = a.invoices.filter(i => !["Paid","Written Off"].includes(i.paymentStatus)).reduce((s,i)=>s+(i.total-(i.paid||0)),0);
          const bo = b.invoices.filter(i => !["Paid","Written Off"].includes(i.paymentStatus)).reduce((s,i)=>s+(i.total-(i.paid||0)),0);
          return bo - ao;
        });
    } else {
      return projects
        .map(p => ({
          entity: p,
          invoices: invoices.filter(i => i.projectId === p.id),
          customer: customers.find(c => c.id === p.customerId),
        }))
        .filter(x => x.invoices.length > 0)
        .sort((a, b) => {
          const ao = a.invoices.filter(i => !["Paid","Written Off"].includes(i.paymentStatus)).reduce((s,i)=>s+(i.total-(i.paid||0)),0);
          const bo = b.invoices.filter(i => !["Paid","Written Off"].includes(i.paymentStatus)).reduce((s,i)=>s+(i.total-(i.paid||0)),0);
          return bo - ao;
        });
    }
  }, [customers, projects, invoices, level]);

  // ── Detail view data ─────────────────────────────────────────────────────────
  const detailData = useMemo(() => {
    if (view.type !== "entity") return null;
    const entityInvoices = view.kind === "customer"
      ? invoices.filter(i => i.customerId === view.id)
      : invoices.filter(i => i.projectId  === view.id);
    const entity = view.kind === "customer"
      ? customers.find(c => c.id === view.id)
      : projects.find(p => p.id === view.id);
    const customerName = view.kind === "project"
      ? customers.find(c => c.id === (entity as Project)?.customerId)?.name
      : undefined;
    const open = entityInvoices.filter(i => !["Paid","Written Off"].includes(i.paymentStatus) && i.collectionStage !== "Closed");
    const outstanding = open.reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
    const buckets = getAgingBuckets(entityInvoices);
    return { entity, entityInvoices, customerName, outstanding, buckets };
  }, [view, invoices, customers, projects]);

  // ═══ RENDER ══════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-stone-50 pb-10">
      {/* ── Sticky header ── */}
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-20">
        {view.type === "entity" ? (
          <button onClick={() => setView({ type: "home" })} className="p-1.5 -ml-1 rounded-lg hover:bg-stone-100 text-stone-600">
            <ChevronLeft size={20} />
          </button>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-stone-900 flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0">AR</div>
        )}

        <div className="flex-1 min-w-0">
          {view.type === "home" ? (
            <>
              <div className="text-[10px] uppercase tracking-widest text-stone-400 font-semibold">Ledger AR</div>
              <div className="text-base font-semibold text-stone-900 leading-tight">Hi, {repName.split(" ")[0]} 👋</div>
            </>
          ) : (
            <>
              <div className="text-[10px] uppercase tracking-widest text-stone-400 font-semibold">
                {view.kind === "customer" ? "Customer" : "Project"}
              </div>
              <div className="text-sm font-semibold text-stone-900 truncate">{detailData?.entity?.name}</div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-100 text-stone-400">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="p-2 rounded-lg hover:bg-stone-100 text-stone-400">
            <LogOut size={15} />
          </button>
        </div>
      </div>

      <div className="px-4 pt-4 max-w-lg mx-auto">
        {/* ── Error ── */}
        {error && (
          <div className="mb-4 flex items-center gap-2 bg-rose-50 ring-1 ring-rose-200 rounded-xl p-3 text-sm text-rose-700">
            <AlertCircle size={15} className="flex-shrink-0" /> {error}
          </div>
        )}

        {/* ════════════ HOME VIEW ════════════ */}
        {view.type === "home" && (
          <>
            {/* Summary stats */}
            {!loading && (
              <div className="mb-4 bg-white rounded-xl ring-1 ring-stone-200 p-4">
                <div className="grid grid-cols-3 gap-4 mb-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-0.5">Total AR</div>
                    <div className="text-lg font-bold text-stone-900 tabular-nums">{fmt.money(totalAR)}</div>
                    <div className="text-[10px] text-stone-400">{openInvoices.length} open</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-0.5">Overdue</div>
                    <div className={`text-lg font-bold tabular-nums ${overdueAR > 0 ? "text-rose-600" : "text-stone-900"}`}>{fmt.money(overdueAR)}</div>
                    <div className="text-[10px] text-stone-400">{overdueCnt} invoice{overdueCnt !== 1 ? "s" : ""}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-0.5">
                      {level === "customer" ? "Customers" : "Projects"}
                    </div>
                    <div className="text-lg font-bold text-stone-900">{entityList.length}</div>
                    <div className="text-[10px] text-stone-400">with AR</div>
                  </div>
                </div>
                <AgingBar buckets={globalBuckets} />
              </div>
            )}

            {/* Entity cards */}
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(n => (
                  <div key={n} className="bg-white rounded-xl ring-1 ring-stone-200 p-4 animate-pulse">
                    <div className="h-3 bg-stone-100 rounded w-1/4 mb-2" />
                    <div className="h-4 bg-stone-100 rounded w-1/2 mb-3" />
                    <div className="h-5 bg-stone-100 rounded w-1/3" />
                  </div>
                ))}
              </div>
            ) : entityList.length === 0 ? (
              <div className="text-center py-16 text-stone-400">
                <FileText size={32} className="mx-auto mb-2 opacity-30" />
                <div className="text-sm">No receivables assigned yet</div>
              </div>
            ) : (
              <div className="space-y-2.5">
                {entityList.map(({ entity, invoices: eInvs, customer }: any) => (
                  <EntityCard
                    key={entity.id}
                    entity={entity}
                    invoices={eInvs}
                    customerName={customer?.name}
                    onClick={() => setView({ type: "entity", id: entity.id, kind: level === "customer" ? "customer" : "project" })}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ════════════ DETAIL VIEW ════════════ */}
        {view.type === "entity" && detailData && (
          <>
            {/* Entity summary card */}
            <div className="bg-white rounded-xl ring-1 ring-stone-200 p-4 mb-4">
              {detailData.customerName && (
                <div className="text-[11px] text-stone-400 mb-0.5">{detailData.customerName}</div>
              )}
              <div className="flex items-end justify-between mb-1">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Outstanding</div>
                  <div className="text-2xl font-bold tabular-nums text-stone-900">{fmt.money(detailData.outstanding)}</div>
                </div>
                <div className="text-right text-[12px] text-stone-500">
                  <div>{detailData.entityInvoices.filter(i => !["Paid","Written Off"].includes(i.paymentStatus) && i.collectionStage !== "Closed").length} open</div>
                  <div>{detailData.entityInvoices.length} total invoices</div>
                </div>
              </div>
              <AgingBar buckets={detailData.buckets} />
            </div>

            {/* Invoice list */}
            {detailData.entityInvoices.length === 0 ? (
              <div className="text-center py-12 text-stone-400">
                <FileText size={28} className="mx-auto mb-2 opacity-30" />
                <div className="text-sm">No invoices</div>
              </div>
            ) : (
              <div className="space-y-2">
                {[...detailData.entityInvoices]
                  .sort((a, b) => {
                    // Open invoices first, then by due date
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

function ChevronLeft({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
