"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, Loader, ExternalLink, Ban, Undo2, CheckCircle2, HandCoins,
  CreditCard, Building2, TrendingUp,
} from "lucide-react";
import { Card, Badge, Button, Toast } from "@/components/ui";
import { fmt } from "@/lib/format";

const STATUS_BADGE: Record<string, string> = {
  paid: "green", open: "blue", draft: "neutral", void: "neutral", uncollectible: "red",
  active: "green", trialing: "blue", past_due: "red", canceled: "neutral", cancelled: "neutral",
  incomplete: "yellow", unpaid: "red",
};
const METHOD_LABEL: Record<string, string> = {
  bank_transfer: "Bank transfer", cheque: "Cheque", cash: "Cash", card_external: "Card (external)", other: "Other", stripe: "Stripe", offline: "Offline",
};

function Stat({ label, value, icon: Icon, accent }: any) {
  return (
    <div className="p-3 rounded-xl border border-stone-800 bg-stone-900/50">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-stone-500">{label}</span>
        <Icon size={13} className={accent ?? "text-stone-600"} />
      </div>
      <p className="text-xl font-semibold text-white tabular-nums">{value}</p>
    </div>
  );
}

export default function OrgBillingPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const [data, setData]     = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]   = useState<any>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/billing/org/${orgId}`);
      const d = await r.json();
      if (r.ok) setData(d);
      else setToast({ type: "error", message: d.error ?? `Failed (${r.status})` });
    } catch (e: any) {
      setToast({ type: "error", message: e?.message ?? "Network error" });
    } finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { if (orgId) load(); }, [orgId, load]);

  const ccy = data?.stats?.currency ?? "GBP";

  const invoiceAction = async (invId: string, body: any, confirmMsg?: string, promptNote?: boolean) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    if (promptNote) { const n = window.prompt("Note / reference (optional):") ?? ""; body.note = n.trim() || undefined; }
    setActing(invId);
    try {
      const r = await fetch(`/api/admin/billing/invoices/${invId}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (r.ok) { setToast({ type: "success", message: "Done" }); load(); }
      else setToast({ type: "error", message: d.error ?? "Failed" });
    } finally { setActing(null); }
  };

  const cancelSub = async () => {
    const sub = data?.subscription;
    if (!sub) return;
    if (!confirm(`Cancel ${data.org.name}'s subscription now and revoke access?`)) return;
    setActing("sub");
    try {
      const r = await fetch(`/api/admin/subscriptions/${sub.id}/cancel`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ atPeriodEnd: false }),
      });
      const d = await r.json();
      if (r.ok) { setToast({ type: "success", message: "Subscription cancelled" }); load(); }
      else setToast({ type: "error", message: d.error ?? "Failed" });
    } finally { setActing(null); }
  };

  if (loading && !data) {
    return <div className="p-6"><Loader size={20} className="animate-spin text-stone-500" /></div>;
  }
  if (!data) return null;

  const { org, subscription: sub, invoices, payments, stats } = data;
  const money = (n: number) => fmt.money((n ?? 0) / 100, ccy);

  return (
    <div className="space-y-5">
      <Link href="/admin/subscriptions" className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-200">
        <ChevronLeft size={14} /> Subscriptions
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-stone-800 flex items-center justify-center"><Building2 size={18} className="text-stone-400" /></div>
          <div>
            <h1 className="text-lg font-semibold text-white">{org.name}</h1>
            <p className="text-xs text-stone-500">
              {data.admins?.[0]?.email ?? sub?.billingEmail ?? "—"}
              {sub && <> · <Badge variant={(STATUS_BADGE[sub.status] ?? "neutral") as any} size="sm">{sub.isActive ? "active" : sub.status}</Badge></>}
            </p>
          </div>
        </div>
        <Link href={`/admin/invoices?org=${orgId}`} className="text-[13px] text-sky-400 hover:text-sky-300">Manage invoices →</Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="MRR" value={money(stats.mrr)} icon={TrendingUp} accent="text-emerald-400" />
        <Stat label="Total billed" value={money(stats.totalBilled)} icon={CreditCard} />
        <Stat label="Total paid" value={money(stats.totalPaid)} icon={CheckCircle2} accent="text-emerald-400" />
        <Stat label="Outstanding" value={money(stats.outstanding)} icon={HandCoins} accent={stats.outstanding > 0 ? "text-amber-400" : "text-stone-600"} />
      </div>

      {/* Subscription */}
      <Card padding="md">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Subscription</h2>
          {sub && sub.source === "stripe" && (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due") && (
            <button onClick={cancelSub} disabled={acting === "sub"}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-rose-700/50 text-rose-400 hover:bg-rose-500/10 disabled:opacity-40">
              {acting === "sub" ? <Loader size={11} className="animate-spin" /> : <Ban size={11} />} Cancel & revoke
            </button>
          )}
        </div>
        {!sub ? (
          <p className="text-sm text-stone-500">No subscription. <Link href="/admin/subscriptions" className="text-sky-400 hover:text-sky-300">Create one →</Link></p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><div className="text-[11px] text-stone-500 mb-0.5">Plan</div><div className="text-stone-200">{sub.planName ?? "—"}</div></div>
            <div><div className="text-[11px] text-stone-500 mb-0.5">Price</div><div className="text-stone-200">{sub.planAmount ? `${fmt.money(sub.planAmount / 100, (sub.planCurrency ?? ccy).toUpperCase())}${sub.planInterval ? `/${sub.planInterval}` : ""}` : "—"}</div></div>
            <div><div className="text-[11px] text-stone-500 mb-0.5">Source</div><div className="text-stone-200 capitalize">{sub.source}</div></div>
            <div><div className="text-[11px] text-stone-500 mb-0.5">{sub.source === "manual" ? "Expires" : "Renews"}</div>
              <div className="text-stone-200">
                {sub.source === "manual"
                  ? (sub.manualExpiresAt ? new Date(sub.manualExpiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "No expiry")
                  : (sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—")}
                {sub.cancelAtPeriodEnd && <span className="text-amber-400 text-[11px] ml-1">(cancelling)</span>}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Invoices */}
      <Card padding="none">
        <div className="px-4 py-3 border-b border-stone-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Invoices ({invoices.length})</h2>
        </div>
        {invoices.length === 0 ? (
          <p className="text-sm text-stone-500 py-8 text-center">No invoices yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-stone-800 text-[11px] text-stone-500">
                {["Invoice", "Billing", "Amount", "Status", "Created", "Paid", "Actions"].map(h => <th key={h} className="text-left px-4 py-2.5 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {invoices.map((inv: any) => {
                  const canVoid = inv.status === "open" || inv.status === "draft";
                  const paidDate = inv.receivedDate ? new Date(inv.receivedDate).getTime() : inv.paidAt;
                  return (
                    <tr key={inv.id} className="border-b border-stone-800/50 hover:bg-stone-800/25">
                      <td className="px-4 py-2.5 font-mono text-xs text-stone-300">{inv.number ?? inv.id.slice(0, 12)}</td>
                      <td className="px-4 py-2.5"><span className="text-[10px] text-stone-400">{inv.billingLabel}</span></td>
                      <td className="px-4 py-2.5 tabular-nums text-stone-200">{money(inv.total)}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant={(STATUS_BADGE[inv.status] ?? "neutral") as any}>{inv.status}</Badge>
                        {inv.refunded && <span className="text-[10px] text-rose-400 ml-1">refunded</span>}
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-stone-400">{inv.created ? new Date(inv.created).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : "—"}</td>
                      <td className="px-4 py-2.5 text-[11px]">{paidDate ? <span className="text-emerald-400/90">{new Date(paidDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}</span> : <span className="text-stone-600">—</span>}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {inv.hostedInvoiceUrl && <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer" className="text-stone-500 hover:text-sky-400 p-1"><ExternalLink size={13} /></a>}
                          {canVoid && (
                            <button onClick={() => invoiceAction(inv.id, { action: "void" }, `Void invoice ${inv.number ?? ""}?`)} disabled={acting === inv.id}
                              className="text-[11px] px-2 py-1 rounded border border-rose-700/50 text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 flex items-center gap-1">
                              <Ban size={11} /> Void
                            </button>
                          )}
                          {inv.status === "paid" && !inv.refunded && (
                            <button onClick={() => invoiceAction(inv.id, { action: "refund" }, `Refund ${money(inv.total)} to ${org.name}?${inv.isSubscription ? " The subscription will be cancelled." : ""}`, true)} disabled={acting === inv.id}
                              className="text-[11px] px-2 py-1 rounded border border-amber-700/50 text-amber-400 hover:bg-amber-500/10 disabled:opacity-40 flex items-center gap-1">
                              <Undo2 size={11} /> Refund
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Payment history */}
      <Card padding="md">
        <h2 className="text-sm font-semibold text-white mb-3">Payment history</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-stone-500 py-4 text-center">No payments recorded yet</p>
        ) : (
          <div className="space-y-1.5">
            {payments.map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-sm py-2 border-b border-stone-800/50 last:border-0">
                <CheckCircle2 size={14} className={p.refunded ? "text-stone-600" : "text-emerald-500"} />
                <span className="text-stone-300 tabular-nums w-24">{money(p.amount)}</span>
                <span className="text-[11px] text-stone-500">{METHOD_LABEL[p.method] ?? p.method}</span>
                {p.invoiceNumber && <span className="text-[11px] text-stone-600 font-mono">{p.invoiceNumber}</span>}
                {p.refunded && <span className="text-[11px] text-rose-400">refunded</span>}
                <span className="text-[11px] text-stone-500 ml-auto">{p.date ? new Date(p.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
