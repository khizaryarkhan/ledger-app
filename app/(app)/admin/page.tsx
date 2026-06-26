"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { Building2, Plus, RefreshCw, Users, AlertTriangle, CreditCard, XCircle, FileText, Clock, CheckCircle2, ChevronRight, ArrowUpRight } from "lucide-react";
import { CreateOrgModal } from "./_org-management";

// ============================================================
// DASHBOARD OVERVIEW (super admin only)
// ============================================================
function AdminDashboard() {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/overview")
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const s = data?.stats ?? {};

  type StatColor = "emerald" | "blue" | "rose" | "amber" | "stone";

  // "Organisations" → "Customers": the billing-active companies. Tapping it opens
  // the single company directory (Accounts), so there's no second list here.
  const KPI_CARDS: { label: string; key: string; icon: any; color: StatColor; href: string; alert?: boolean }[] = [
    { label: "Active subscriptions",  key: "active",               icon: CheckCircle2,  color: "emerald", href: "/admin/billing" },
    { label: "Trialing",              key: "trialing",             icon: Clock,         color: "blue",    href: "/admin/subscriptions" },
    { label: "Past due",              key: "pastDue",              icon: AlertTriangle, color: "rose",    href: "/admin/subscriptions", alert: true },
    { label: "Pending cancellations", key: "pendingCancellations", icon: XCircle,       color: "amber",   href: "/admin/cancellations", alert: true },
    { label: "New leads",             key: "newLeads",             icon: FileText,      color: "blue",    href: "/admin/leads", alert: true },
    { label: "Failed payments",       key: "failedPayments",       icon: CreditCard,    color: "rose",    href: "/admin/subscriptions", alert: true },
    { label: "Customers",             key: "totalOrgs",            icon: Building2,     color: "stone",   href: "/admin/customers" },
    { label: "Total users",           key: "totalUsers",           icon: Users,         color: "stone",   href: "/admin/team" },
  ];

  const colorMap: Record<StatColor, { bg: string; icon: string; val: string }> = {
    emerald: { bg: "bg-emerald-500/10", icon: "text-emerald-400", val: "text-emerald-400" },
    blue:    { bg: "bg-blue-500/10",    icon: "text-blue-400",    val: "text-blue-400"    },
    rose:    { bg: "bg-rose-500/10",    icon: "text-rose-400",    val: "text-rose-400"    },
    amber:   { bg: "bg-amber-500/10",   icon: "text-amber-400",   val: "text-amber-300"   },
    stone:   { bg: "bg-stone-800",      icon: "text-stone-400",   val: "text-white"       },
  };

  const alerts = KPI_CARDS.filter(c => c.alert && (s[c.key] ?? 0) > 0);

  return (
    <div className="space-y-4">
      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {KPI_CARDS.map(card => {
          const { bg, icon: iconCls, val } = colorMap[card.color];
          const value = loading ? null : (s[card.key] ?? 0);
          const isAlert = card.alert && value && value > 0;
          return (
            <Link key={card.key} href={card.href}
              className={`group relative rounded-xl p-4 border transition-all hover:border-stone-600 ${
                isAlert ? "border-amber-500/30 bg-stone-900" : "border-stone-800 bg-stone-900"
              }`}
            >
              {isAlert && (
                <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              )}
              <div className="flex items-start justify-between mb-3">
                <p className="text-[11px] text-stone-500 leading-snug">{card.label}</p>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${bg}`}>
                  <card.icon size={13} className={iconCls} />
                </div>
              </div>
              {loading ? (
                <div className="h-8 w-12 bg-stone-800 rounded animate-pulse" />
              ) : (
                <p className={`text-3xl font-bold tabular-nums ${val}`}>{value}</p>
              )}
              <ChevronRight size={12} className="absolute bottom-3 right-3 text-stone-700 group-hover:text-stone-400 transition-colors" />
            </Link>
          );
        })}
      </div>

      {/* Alert followup cards */}
      {!loading && alerts.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-stone-500 uppercase tracking-widest">Needs attention</p>
          <div className="grid sm:grid-cols-3 gap-3">
            {alerts.map(card => {
              const value = s[card.key] ?? 0;
              const copyMap: Record<string, { title: string; body: string; cta: string; color: string }> = {
                pendingCancellations: {
                  title: `${value} cancellation${value !== 1 ? "s" : ""} awaiting review`,
                  body:  "Customers have requested to cancel. Review and set the cancellation schedule.",
                  cta:   "Review requests",
                  color: "amber",
                },
                newLeads: {
                  title: `${value} new lead${value !== 1 ? "s" : ""} to follow up`,
                  body:  "Demo or interest requests submitted from the landing page.",
                  cta:   "View leads",
                  color: "blue",
                },
                failedPayments: {
                  title: `${value} failed payment${value !== 1 ? "s" : ""}`,
                  body:  "Subscriptions with payment failures that may need outreach.",
                  cta:   "View subscriptions",
                  color: "rose",
                },
                pastDue: {
                  title: `${value} past-due subscription${value !== 1 ? "s" : ""}`,
                  body:  "Subscriptions past their due date — may affect access.",
                  cta:   "View subscriptions",
                  color: "rose",
                },
              };
              const meta = copyMap[card.key];
              if (!meta) return null;
              const borderColor = meta.color === "amber" ? "border-amber-500/25" : meta.color === "rose" ? "border-rose-500/25" : "border-blue-500/25";
              const titleColor  = meta.color === "amber" ? "text-amber-300"  : meta.color === "rose" ? "text-rose-300"  : "text-blue-300";
              const ctaColor    = meta.color === "amber" ? "text-amber-400 hover:text-amber-200" : meta.color === "rose" ? "text-rose-400 hover:text-rose-200" : "text-blue-400 hover:text-blue-200";
              return (
                <div key={card.key} className={`rounded-xl border ${borderColor} bg-stone-900 p-4 flex flex-col gap-3`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${colorMap[card.color].bg}`}>
                      <card.icon size={14} className={colorMap[card.color].icon} />
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${titleColor}`}>{meta.title}</p>
                      <p className="text-[11px] text-stone-500 mt-0.5 leading-snug">{meta.body}</p>
                    </div>
                  </div>
                  <Link href={card.href} className={`text-xs font-medium flex items-center gap-1 ${ctaColor} transition-colors`}>
                    {meta.cta} <ChevronRight size={11} />
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent activity strip */}
      {!loading && data?.recentAuditLogs?.length > 0 && (
        <div className="rounded-xl border border-stone-800 bg-stone-900">
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
            <p className="text-xs font-semibold text-stone-400">Recent billing events</p>
            <Link href="/admin/audit" className="text-[11px] text-stone-500 hover:text-stone-200 transition-colors">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-stone-800/60">
            {data.recentAuditLogs.slice(0, 4).map((log: any) => (
              <div key={log.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-[11px] text-stone-200 font-medium capitalize flex-1 min-w-0 truncate">
                  {log.action.replace(/_/g, " ")}
                </span>
                <span className="text-[11px] text-stone-500 truncate max-w-[120px]">{log.orgName ?? "—"}</span>
                <span className="text-[11px] text-stone-600 whitespace-nowrap">
                  {new Date(log.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// MAIN ADMIN PAGE — command center for platform administrators.
// ============================================================
export default function AdminPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role;
  const isSuperAdmin = role === "super_admin";
  const isPlatformAdmin = role === "super_admin" || role === "platform_admin";

  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!isPlatformAdmin && session) router.push("/dashboard");
  }, [isPlatformAdmin, session, router]);

  if (!isPlatformAdmin) return null;

  return (
    <div className="max-w-[1100px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-base font-semibold text-white">Overview</h1>
          <p className="text-xs text-stone-500 mt-0.5">Platform health · billing · what needs attention</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setRefreshKey(k => k + 1)} icon={RefreshCw}>Refresh</Button>
          {isSuperAdmin && <Button icon={Plus} size="sm" onClick={() => setShowCreateOrg(true)}>New organisation</Button>}
        </div>
      </div>

      <AdminDashboard key={refreshKey} />

      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        <Link href="/admin/leads"
          className="group flex items-center gap-3 rounded-xl border border-stone-800 bg-stone-900 px-4 py-3.5 hover:border-stone-600 transition-colors">
          <div className="w-9 h-9 rounded-lg bg-stone-800 flex items-center justify-center shrink-0">
            <FileText size={16} className="text-stone-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white">Pipeline</p>
            <p className="text-[11px] text-stone-500">Browse all leads and deals across every stage.</p>
          </div>
          <span className="text-xs text-stone-400 group-hover:text-stone-200 flex items-center gap-1 shrink-0">
            Open <ArrowUpRight size={12} />
          </span>
        </Link>
        <Link href="/admin/customers"
          className="group flex items-center gap-3 rounded-xl border border-stone-800 bg-stone-900 px-4 py-3.5 hover:border-stone-600 transition-colors">
          <div className="w-9 h-9 rounded-lg bg-stone-800 flex items-center justify-center shrink-0">
            <Building2 size={16} className="text-stone-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white">Customers</p>
            <p className="text-[11px] text-stone-500">Provisioned organisations with subscriptions and billing.</p>
          </div>
          <span className="text-xs text-stone-400 group-hover:text-stone-200 flex items-center gap-1 shrink-0">
            Open <ArrowUpRight size={12} />
          </span>
        </Link>
      </div>

      {showCreateOrg && (
        <CreateOrgModal
          onClose={() => setShowCreateOrg(false)}
          onCreated={() => router.push("/admin/customers")}
        />
      )}
    </div>
  );
}
