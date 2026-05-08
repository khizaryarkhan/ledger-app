"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession, signOut } from "next-auth/react";
import { fmt, formatDate, daysOverdue, getDueStatus } from "@/lib/format";
import { LogOut, RefreshCw, AlertCircle, Clock, CheckCircle, TrendingUp, FileText, ChevronDown, ChevronUp } from "lucide-react";

type Invoice = {
  id: string;
  invoiceNumber: string;
  customerId: string;
  projectId: string | null;
  invoiceDate: string;
  dueDate: string;
  total: number;
  paid: number;
  currency: string;
  paymentStatus: string;
  collectionStage: string;
  billingEmail: string | null;
};

type Customer = { id: string; name: string; };
type Project  = { id: string; name: string; customerId: string; };

function StatCard({ label, value, sub, color = "stone" }: { label: string; value: string; sub?: string; color?: string }) {
  const colors: Record<string, string> = {
    stone:  "bg-white ring-stone-200 text-stone-900",
    rose:   "bg-rose-50 ring-rose-200 text-rose-700",
    amber:  "bg-amber-50 ring-amber-200 text-amber-700",
    emerald:"bg-emerald-50 ring-emerald-200 text-emerald-700",
  };
  return (
    <div className={`rounded-xl p-4 ring-1 ${colors[color]}`}>
      <div className="text-[11px] uppercase tracking-wider font-semibold opacity-60 mb-1">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] opacity-60 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function RepPortalPage() {
  const { data: session } = useSession();
  const [invoices, setInvoices]   = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [projects, setProjects]   = useState<Project[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [filter, setFilter]       = useState<"all" | "overdue" | "due-soon" | "open">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const repName = session?.user?.name || "Rep";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [invRes, custRes, projRes] = await Promise.all([
        fetch("/api/invoices"),
        fetch("/api/customers"),
        fetch("/api/projects"),
      ]);
      if (!invRes.ok) { setError("Failed to load invoices"); return; }
      setInvoices(await invRes.json());
      if (custRes.ok) setCustomers(await custRes.json());
      if (projRes.ok) setProjects(await projRes.json());
    } catch {
      setError("Network error — please refresh");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const enriched = useMemo(() => invoices.map(inv => {
    const isPaidOrClosed = ["Paid", "Written Off"].includes(inv.paymentStatus) || inv.collectionStage === "Closed";
    const outstanding = isPaidOrClosed ? 0 : inv.total - (inv.paid || 0);
    const dueStatus = getDueStatus(inv);
    const customer = customers.find(c => c.id === inv.customerId);
    const project  = projects.find(p => p.id === inv.projectId);
    return { ...inv, outstanding, dueStatus, customer, project, isPaidOrClosed, daysOv: daysOverdue(inv.dueDate) };
  }), [invoices, customers, projects]);

  const openInvoices = enriched.filter(i => !i.isPaidOrClosed);

  const filtered = useMemo(() => {
    if (filter === "overdue")  return openInvoices.filter(i => i.dueStatus === "Overdue");
    if (filter === "due-soon") return openInvoices.filter(i => i.dueStatus === "Due Soon" || i.dueStatus === "Due Today");
    if (filter === "open")     return openInvoices;
    return enriched;
  }, [enriched, openInvoices, filter]);

  const totalAR     = openInvoices.reduce((s, i) => s + i.outstanding, 0);
  const overdueAR   = openInvoices.filter(i => i.dueStatus === "Overdue").reduce((s, i) => s + i.outstanding, 0);
  const overdueCount = openInvoices.filter(i => i.dueStatus === "Overdue").length;
  const dueSoonCount = openInvoices.filter(i => i.dueStatus === "Due Soon" || i.dueStatus === "Due Today").length;

  const statusColors: Record<string, string> = {
    "Overdue":   "bg-rose-100 text-rose-700",
    "Due Today": "bg-amber-100 text-amber-700",
    "Due Soon":  "bg-yellow-100 text-yellow-700",
    "Not Due":   "bg-stone-100 text-stone-600",
    "Paid":      "bg-emerald-100 text-emerald-700",
    "Written Off":"bg-stone-100 text-stone-500",
  };

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-stone-400 font-semibold">Ledger AR</div>
          <div className="text-base font-semibold text-stone-900 leading-tight">Hi, {repName.split(" ")[0]} 👋</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-100 text-stone-500">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="p-2 rounded-lg hover:bg-stone-100 text-stone-500">
            <LogOut size={16} />
          </button>
        </div>
      </div>

      <div className="px-4 pt-4 pb-8 max-w-lg mx-auto">
        {/* Error */}
        {error && (
          <div className="mb-4 flex items-center gap-2 bg-rose-50 ring-1 ring-rose-200 rounded-xl p-3 text-sm text-rose-700">
            <AlertCircle size={15} /> {error}
          </div>
        )}

        {/* Stats */}
        {!loading && (
          <div className="grid grid-cols-2 gap-3 mb-5">
            <StatCard label="Total AR" value={fmt.money(totalAR)} sub={`${openInvoices.length} open invoices`} />
            <StatCard label="Overdue" value={fmt.money(overdueAR)} sub={`${overdueCount} invoice${overdueCount !== 1 ? "s" : ""}`} color={overdueAR > 0 ? "rose" : "stone"} />
            <StatCard label="Due Soon" value={String(dueSoonCount)} sub="invoices" color={dueSoonCount > 0 ? "amber" : "stone"} />
            <StatCard label="Collected" value={fmt.money(enriched.filter(i => i.isPaidOrClosed).reduce((s, i) => s + i.total, 0))} sub="paid / closed" color="emerald" />
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1 mb-4 bg-stone-100 p-1 rounded-xl">
          {([
            { id: "open",     label: "Open",     count: openInvoices.length },
            { id: "overdue",  label: "Overdue",  count: overdueCount },
            { id: "due-soon", label: "Due Soon", count: dueSoonCount },
            { id: "all",      label: "All",      count: enriched.length },
          ] as const).map(tab => (
            <button key={tab.id} onClick={() => setFilter(tab.id)}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${filter === tab.id ? "bg-white text-stone-900 shadow-sm" : "text-stone-500"}`}>
              {tab.label}
              {tab.count > 0 && (
                <span className={`ml-1 ${filter === tab.id ? "text-stone-500" : "text-stone-400"}`}>({tab.count})</span>
              )}
            </button>
          ))}
        </div>

        {/* Invoice list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(n => (
              <div key={n} className="bg-white rounded-xl ring-1 ring-stone-200 p-4 animate-pulse">
                <div className="h-4 bg-stone-100 rounded w-1/3 mb-2" />
                <div className="h-3 bg-stone-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle size={32} className="text-emerald-400 mx-auto mb-2" />
            <div className="text-stone-500 text-sm">
              {filter === "overdue" ? "No overdue invoices 🎉" : filter === "due-soon" ? "Nothing due soon" : "No invoices"}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).map(inv => {
              const isExpanded = expandedId === inv.id;
              return (
                <div key={inv.id} className="bg-white rounded-xl ring-1 ring-stone-200 overflow-hidden">
                  <button
                    className="w-full text-left px-4 py-3"
                    onClick={() => setExpandedId(isExpanded ? null : inv.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-semibold text-stone-600">{inv.invoiceNumber}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${statusColors[inv.dueStatus] || "bg-stone-100 text-stone-500"}`}>
                            {inv.dueStatus}
                          </span>
                        </div>
                        <div className="text-sm font-semibold text-stone-900 mt-0.5 truncate">
                          {inv.customer?.name || "—"}
                        </div>
                        {inv.project && (
                          <div className="text-[11px] text-stone-400 truncate">{inv.project.name}</div>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className={`text-base font-bold tabular-nums ${inv.isPaidOrClosed ? "text-stone-400" : inv.dueStatus === "Overdue" ? "text-rose-600" : "text-stone-900"}`}>
                          {fmt.money(inv.outstanding, inv.currency)}
                        </div>
                        <div className="text-[11px] text-stone-400">
                          {inv.isPaidOrClosed ? inv.paymentStatus : `Due ${formatDate(inv.dueDate)}`}
                        </div>
                        {isExpanded ? <ChevronUp size={13} className="mt-0.5 ml-auto text-stone-300" /> : <ChevronDown size={13} className="mt-0.5 ml-auto text-stone-300" />}
                      </div>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-stone-100 px-4 py-3 bg-stone-50/50 space-y-1.5 text-[12px]">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <div><span className="text-stone-400">Invoice date</span><div className="font-medium text-stone-700">{formatDate(inv.invoiceDate)}</div></div>
                        <div><span className="text-stone-400">Due date</span><div className={`font-medium ${inv.daysOv > 0 ? "text-rose-600" : "text-stone-700"}`}>{formatDate(inv.dueDate)}{inv.daysOv > 0 && <span className="ml-1 text-rose-500">+{inv.daysOv}d</span>}</div></div>
                        <div><span className="text-stone-400">Total</span><div className="font-medium text-stone-700 tabular-nums">{fmt.money(inv.total, inv.currency)}</div></div>
                        <div><span className="text-stone-400">Paid</span><div className="font-medium text-emerald-600 tabular-nums">{fmt.money(inv.paid || 0, inv.currency)}</div></div>
                        <div><span className="text-stone-400">Stage</span><div className="font-medium text-stone-700">{inv.collectionStage}</div></div>
                        <div><span className="text-stone-400">Status</span><div className="font-medium text-stone-700">{inv.paymentStatus}</div></div>
                      </div>
                      {inv.billingEmail && (
                        <div className="pt-1 border-t border-stone-100">
                          <span className="text-stone-400">Billing email</span>
                          <div className="font-medium text-blue-600 break-all">{inv.billingEmail}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-[10px] text-stone-300 uppercase tracking-widest">
          Ledger AR Collections
        </div>
      </div>
    </div>
  );
}
