"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useData } from "@/components/data-provider";
import { Card, Button, Badge } from "@/components/ui";
import {
  ChevronLeft, Link2, Unlink, RefreshCw, Check, AlertTriangle, Loader,
  CheckCircle, XCircle, Clock, Database,
} from "lucide-react";
import { fmt } from "@/lib/format";

export default function IntegrationsSettingsPage() {
  const { customers, invoices, refresh, toast, orgSettings } = useData() as any;
  const ccy: string = orgSettings?.currency ?? "EUR";
  const searchParams = useSearchParams();

  // QBO
  const [qboStatus, setQboStatus] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [syncHistory, setSyncHistory] = useState<any[]>([]);
  const [disconnecting, setDisconnecting] = useState(false);

  // Backfill paid-at dates
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ backfilled: number; skipped: number } | null>(null);

  // Backfill inactive
  const [backfillingInactive, setBackfillingInactive] = useState(false);
  const [backfillInactiveResult, setBackfillInactiveResult] = useState<{ customersDeactivated: number; projectsDeactivated: number } | null>(null);

  // Webhook health
  const [webhookHealth, setWebhookHealth] = useState<any>(null);

  const loadWebhookHealth = () => {
    fetch("/api/qbo/webhook-health")
      .then(r => r.ok ? r.json() : null)
      .then(setWebhookHealth)
      .catch(() => {});
  };

  // QBO data verification
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch("/api/qbo/verify");
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "Verification failed", "error");
      } else {
        setVerifyResult(data);
      }
    } catch {
      toast("Verification failed", "error");
    } finally {
      setVerifying(false);
    }
  };

  // AR amount verification
  const [verifyingAR, setVerifyingAR] = useState(false);
  const [arVerifyResult, setArVerifyResult] = useState<any>(null);

  const handleVerifyAR = async () => {
    setVerifyingAR(true);
    setArVerifyResult(null);
    try {
      const res = await fetch("/api/qbo/verify-ar");
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "AR verification failed", "error");
      } else {
        setArVerifyResult(data);
      }
    } catch {
      toast("AR verification failed", "error");
    } finally {
      setVerifyingAR(false);
    }
  };

  useEffect(() => {
    fetch("/api/qbo/sync").then(r => r.json()).then(setQboStatus).catch(() => setQboStatus({ connected: false }));
    fetch("/api/qbo/history").then(r => r.json()).then(setSyncHistory).catch(() => {});
    loadWebhookHealth();
  }, []);

  useEffect(() => {
    const qbo = searchParams.get("qbo");
    if (qbo === "connected") {
      toast("QuickBooks connected!");
      fetch("/api/qbo/sync").then(r => r.json()).then(setQboStatus);
    } else if (qbo === "error") {
      toast(`QBO error: ${searchParams.get("reason")}`, "error");
    }
  }, [searchParams]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/qbo/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "Sync failed", "error");
      } else {
        setSyncResult(data.synced);
        const diff = data.synced.difference || 0;
        if (data.synced.paymentsPersistenceError) {
          toast(`Payments not stored: ${data.synced.paymentsPersistenceError}`, "error");
        } else if (diff < 1) {
          toast("Sync complete — AR reconciled ✓");
        } else {
          toast(`Sync complete — €${diff.toFixed(2)} variance, check reconciliation`, "info");
        }
        await refresh();
        fetch("/api/qbo/history").then(r => r.json()).then(setSyncHistory).catch(() => {});
      }
    } catch {
      toast("Sync failed", "error");
    } finally {
      setSyncing(false);
    }
  };

  const handleQboDisconnect = async () => {
    setDisconnecting(true);
    try {
      await fetch("/api/qbo/disconnect", { method: "POST" });
      setQboStatus({ connected: false });
      setSyncResult(null);
      toast("QuickBooks disconnected");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await fetch("/api/qbo/backfill-paid-at", { method: "POST" });
      const data = await res.json();
      if (!res.ok) toast(data.error || "Backfill failed", "error");
      else {
        setBackfillResult(data);
        toast(`Backfilled ${data.backfilled} invoice${data.backfilled !== 1 ? "s" : ""}`);
      }
    } catch {
      toast("Backfill failed", "error");
    } finally {
      setBackfilling(false);
    }
  };

  const handleBackfillInactive = async () => {
    setBackfillingInactive(true);
    setBackfillInactiveResult(null);
    try {
      const res = await fetch("/api/backfill-inactive", { method: "POST" });
      const data = await res.json();
      if (!res.ok) toast(data.error || "Backfill failed", "error");
      else {
        setBackfillInactiveResult(data);
        toast(`Marked ${data.customersDeactivated} customers and ${data.projectsDeactivated} projects inactive`);
        await refresh();
      }
    } catch {
      toast("Backfill failed", "error");
    } finally {
      setBackfillingInactive(false);
    }
  };

  const isReconciled = syncResult && Math.abs(syncResult.difference || 0) < 1;

  return (
    <div className="p-6 max-w-[860px] mx-auto">
      {/* Back + header */}
      <div className="mb-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-200 mb-3 transition-colors"
        >
          <ChevronLeft size={14} /> Settings
        </Link>
        <h1 className="text-2xl font-semibold text-white tracking-tight">Integrations</h1>
        <p className="text-sm text-stone-400 mt-1">Connect external services and manage data sync.</p>
      </div>

      {/* QuickBooks Online */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Link2 size={16} className="text-stone-400" />
          <h3 className="text-sm font-semibold text-white">QuickBooks Online</h3>
          {qboStatus?.connected && <Badge variant="green" size="sm">Connected</Badge>}
        </div>

        {qboStatus === null ? (
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <Loader size={14} className="animate-spin" /> Checking…
          </div>
        ) : qboStatus.connected ? (
          <div className="space-y-4">
            {/* Connected banner */}
            <div className="bg-emerald-500/10 ring-1 ring-emerald-500/30 rounded-md p-3 flex items-center gap-2">
              <Check size={15} className="text-emerald-400" />
              <div>
                <div className="text-sm font-medium text-emerald-400">
                  Connected to {qboStatus.companyName}
                </div>
                <div className="text-[11px] text-emerald-500/80 mt-0.5">Realm ID: {qboStatus.realmId}</div>
              </div>
            </div>

            <div className="text-sm text-stone-400">
              Sync pulls all open invoices (Balance &gt; 0) and unapplied credits from QBO. Invoices paid in
              QBO auto-close in Ledger. Your collection notes, stages and tasks are never overwritten.
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={handleSync} disabled={syncing}>
                {syncing ? (
                  <span className="flex items-center gap-2">
                    <Loader size={14} className="animate-spin" />Syncing from QuickBooks…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <RefreshCw size={14} />Sync from QuickBooks
                  </span>
                )}
              </Button>
              <Link href="/settings/integrations/reconcile">
                <Button variant="secondary" size="sm">
                  <span className="flex items-center gap-2">
                    <RefreshCw size={14} />Reconcile with QBO
                  </span>
                </Button>
              </Link>
              <Button variant="secondary" size="sm" onClick={handleBackfill} disabled={backfilling || syncing}>
                {backfilling ? (
                  <span className="flex items-center gap-2">
                    <Loader size={14} className="animate-spin" />Backfilling…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Clock size={14} />Backfill payment dates
                  </span>
                )}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleVerify} disabled={verifying}>
                {verifying ? (
                  <span className="flex items-center gap-2">
                    <Loader size={14} className="animate-spin" />Comparing…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Database size={14} />Verify QBO data
                  </span>
                )}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleVerifyAR} disabled={verifyingAR}>
                {verifyingAR ? (
                  <span className="flex items-center gap-2">
                    <Loader size={14} className="animate-spin" />Comparing AR…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Database size={14} />Verify AR total
                  </span>
                )}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleQboDisconnect} disabled={disconnecting}>
                <Unlink size={14} className="mr-1.5" />
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>

            {/* Verify result — side-by-side counts */}
            {verifyResult && (
              <div className="rounded-md ring-1 ring-stone-700 overflow-hidden">
                <div className="px-3 py-2 bg-stone-800/60 border-b border-stone-800 flex items-center justify-between">
                  <div className="text-xs font-semibold text-stone-300 uppercase tracking-wider">
                    QBO vs Ledger
                  </div>
                  <div className="text-[10px] text-stone-500">
                    Checked {new Date(verifyResult.checkedAt).toLocaleString("en-IE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-[11px] text-stone-500 uppercase">
                    <tr className="border-b border-stone-800">
                      <th className="text-left px-3 py-2 font-medium">Entity</th>
                      <th className="text-right px-3 py-2 font-medium">In QBO</th>
                      <th className="text-right px-3 py-2 font-medium">In Ledger</th>
                      <th className="text-right px-3 py-2 font-medium">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {verifyResult.rows.map((row: any) => {
                      const diff = row.ledger - row.qbo;
                      const inSync = diff === 0;
                      const ledgerLow = diff < 0;
                      return (
                        <tr key={row.entity} className="border-b border-stone-800/50 last:border-0">
                          <td className="px-3 py-2 text-stone-200">{row.entity}</td>
                          <td className="px-3 py-2 text-right text-stone-400 tabular-nums">
                            {row.qbo === -1 ? "—" : row.qbo.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right text-stone-400 tabular-nums">
                            {row.ledger.toLocaleString()}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums font-medium ${
                            inSync ? "text-emerald-600" : ledgerLow ? "text-rose-600" : "text-amber-600"
                          }`}>
                            {inSync ? "✓" : (diff > 0 ? "+" : "") + diff.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="px-3 py-2 bg-stone-800/40 border-t border-stone-800 text-[11px] text-stone-500 flex items-center justify-between">
                  <span>Payment applications stored: <span className="font-medium text-stone-300">{verifyResult.paymentApplications?.toLocaleString() ?? 0}</span></span>
                  <span>
                    {verifyResult.rows.every((r: any) => r.qbo === r.ledger)
                      ? <span className="text-emerald-400 font-medium">✓ Ledger matches QBO</span>
                      : <span className="text-amber-400">Run Sync to pull missing data</span>}
                  </span>
                </div>
              </div>
            )}

            {/* AR verification result */}
            {arVerifyResult && (
              <div className="rounded-md ring-1 ring-stone-700 overflow-hidden">
                <div className="px-3 py-2 bg-stone-800/60 border-b border-stone-800 flex items-center justify-between">
                  <div className="text-xs font-semibold text-stone-300 uppercase tracking-wider">AR Total — QBO vs Ledger</div>
                  <div className="text-[10px] text-stone-500">Checked {new Date(arVerifyResult.checkedAt).toLocaleString("en-IE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                </div>
                <table className="w-full text-[12px]">
                  <thead className="text-[10px] text-stone-500 uppercase">
                    <tr className="border-b border-stone-800">
                      <th className="text-left px-2 py-2 font-medium">Cur</th>
                      <th className="text-right px-2 py-2 font-medium">QBO Invoices</th>
                      <th className="text-right px-2 py-2 font-medium">QBO Credits</th>
                      <th className="text-right px-2 py-2 font-medium">QBO Net</th>
                      <th className="text-right px-2 py-2 font-medium">Ledger Invoices</th>
                      <th className="text-right px-2 py-2 font-medium">Ledger Credits</th>
                      <th className="text-right px-2 py-2 font-medium">Ledger Net</th>
                      <th className="text-right px-2 py-2 font-medium">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {arVerifyResult.byCurrency.map((row: any) => {
                      const diff = row.ledger.net - row.qbo.net;
                      const inSync = Math.abs(diff) < 0.50;
                      return (
                        <tr key={row.currency} className="border-b border-stone-800/50 last:border-0">
                          <td className="px-2 py-2 font-mono text-stone-300">{row.currency}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-400">{fmt.money(row.qbo.invoices, row.currency)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-400">{fmt.money(row.qbo.credits, row.currency)}</td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold text-white">{fmt.money(row.qbo.net, row.currency)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-400">{fmt.money(row.ledger.invoices, row.currency)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-400">{fmt.money(row.ledger.credits, row.currency)}</td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold text-white">{fmt.money(row.ledger.net, row.currency)}</td>
                          <td className={`px-2 py-2 text-right tabular-nums font-semibold ${inSync ? "text-emerald-600" : "text-rose-600"}`}>
                            {inSync ? "✓" : fmt.money(diff, row.currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="px-3 py-2 bg-stone-800/40 border-t border-stone-800 text-[11px] text-stone-500 flex items-center justify-between">
                  <span>QBO open: {arVerifyResult.qbo.openInvoiceCount} invoices, {arVerifyResult.qbo.openCmCount} credit memos</span>
                  <span>
                    {Math.abs(arVerifyResult.difference) < 0.50
                      ? <span className="text-emerald-400 font-medium">✓ AR totals match QBO</span>
                      : <span className="text-amber-400">Ledger AR differs by {fmt.money(Math.abs(arVerifyResult.difference), "EUR")}</span>}
                  </span>
                </div>
              </div>
            )}

            {/* Backfill result */}
            {backfillResult && (
              <div className="bg-emerald-500/10 ring-1 ring-emerald-500/30 rounded-md px-3 py-2 text-sm text-emerald-400 flex items-center gap-2">
                <Check size={14} className="text-emerald-400 shrink-0" />
                <span>
                  Backfilled <strong>{backfillResult.backfilled}</strong> invoice
                  {backfillResult.backfilled !== 1 ? "s" : ""} with payment dates
                  {backfillResult.skipped > 0
                    ? ` · ${backfillResult.skipped} skipped (no QBO payment found)`
                    : ""}
                </span>
              </div>
            )}

            {/* Reconciliation panel */}
            {syncResult && (
              <div className="space-y-3">
                <div
                  className={`rounded-lg p-4 ring-1 ${
                    isReconciled ? "bg-emerald-500/10 ring-emerald-500/30" : "bg-amber-500/10 ring-amber-500/30"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    {isReconciled ? (
                      <CheckCircle size={16} className="text-emerald-400" />
                    ) : (
                      <AlertTriangle size={16} className="text-amber-400" />
                    )}
                    <span className="text-sm font-semibold">
                      {isReconciled ? "AR Reconciled ✓" : "AR Variance — investigation needed"}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { label: "QBO Total AR", value: syncResult.qboTotalAR, note: "From QBO open invoices" },
                      { label: "Ledger Total AR", value: syncResult.ledgerTotalAR, note: "Invoices in Ledger" },
                      {
                        label: "Difference",
                        value: syncResult.difference || 0,
                        note: isReconciled ? "Fully reconciled" : "Check credits/JEs",
                        colored: true,
                      },
                    ].map(({ label, value, note, colored }) => (
                      <div key={label} className="bg-stone-900/60 rounded-md p-3">
                        <div className="text-[11px] text-stone-500 mb-1">{label}</div>
                        <div
                          className={`text-lg font-semibold tabular-nums ${
                            colored
                              ? isReconciled
                                ? "text-emerald-400"
                                : "text-amber-400"
                              : "text-white"
                          }`}
                        >
                          {fmt.money(value, ccy)}
                        </div>
                        <div className="text-[10px] text-stone-400 mt-0.5">{note}</div>
                      </div>
                    ))}
                  </div>
                  {!isReconciled && (
                    <div className="mt-3 text-xs text-amber-300 bg-amber-500/10 rounded p-2">
                      A variance may be caused by: Journal Entries hitting AR, retainer deposits, write-offs,
                      or invoices in a currency not yet synced. Check QBO AR Aging report.
                    </div>
                  )}
                </div>

                {/* Sync stats */}
                <div className="bg-stone-800/40 ring-1 ring-stone-700 rounded-md p-3">
                  <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
                    This sync
                  </div>
                  <div className="grid grid-cols-4 gap-x-2 gap-y-3 text-center">
                    {[
                      { label: "Customers", value: syncResult.customers },
                      { label: "Contacts", value: syncResult.contacts },
                      { label: "New invoices", value: syncResult.invoicesCreated },
                      { label: "Updated", value: syncResult.invoicesUpdated },
                      { label: "Auto-closed", value: syncResult.invoicesClosed },
                      { label: "Paid-dates fixed", value: syncResult.paidAtBackfilled || 0 },
                      { label: "Payments", value: (syncResult.paymentsCreated || 0) + (syncResult.paymentsUpdated || 0) },
                      { label: "Refunds", value: (syncResult.refundsCreated || 0) + (syncResult.refundsUpdated || 0) },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <div className="text-xl font-semibold text-white">{value}</div>
                        <div className="text-[10px] text-stone-500">{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Webhook health — real-time delivery status */}
            {webhookHealth && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
                    Real-time webhook health
                  </div>
                  <button onClick={loadWebhookHealth}
                    className="text-[11px] text-stone-400 hover:text-stone-200 flex items-center gap-1">
                    <RefreshCw size={10} /> Refresh
                  </button>
                </div>

                {(() => {
                  const lastAt = webhookHealth.lastWebhookAt ? new Date(webhookHealth.lastWebhookAt) : null;
                  const lastSuccessAt = webhookHealth.lastSuccessAt ? new Date(webhookHealth.lastSuccessAt) : null;
                  const minutesSinceLast = lastAt ? Math.floor((Date.now() - lastAt.getTime()) / 60000) : null;
                  const minutesSinceSuccess = lastSuccessAt ? Math.floor((Date.now() - lastSuccessAt.getTime()) / 60000) : null;

                  // Health badge logic:
                  // - never received any webhook → "Not yet received"
                  // - last success within 24h → "Healthy"
                  // - last success > 24h ago → "Quiet"
                  // - errors > 0 in last 24h → "Errors"
                  let healthLabel = "Not yet received";
                  let healthColor = "neutral";
                  if (lastSuccessAt) {
                    if (webhookHealth.errorsLast24h > 0) {
                      healthLabel = `${webhookHealth.errorsLast24h} error(s) in 24h`;
                      healthColor = "amber";
                    } else if (minutesSinceSuccess! < 60 * 24) {
                      healthLabel = "Healthy";
                      healthColor = "emerald";
                    } else {
                      healthLabel = "No events in 24h";
                      healthColor = "amber";
                    }
                  }

                  const fmtRelative = (mins: number | null) => {
                    if (mins === null) return "never";
                    if (mins < 1) return "just now";
                    if (mins < 60) return `${mins} min ago`;
                    const h = Math.floor(mins / 60);
                    if (h < 48) return `${h} h ago`;
                    return `${Math.floor(h / 24)} d ago`;
                  };

                  return (
                    <div className={`rounded-lg p-3 ring-1 ${
                      healthColor === "emerald" ? "bg-emerald-500/10 ring-emerald-500/30" :
                      healthColor === "amber" ? "bg-amber-500/10 ring-amber-500/30" :
                      "bg-stone-800/40 ring-stone-700"
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {healthColor === "emerald" ? <CheckCircle size={14} className="text-emerald-400" /> :
                           healthColor === "amber" ? <AlertTriangle size={14} className="text-amber-400" /> :
                           <Clock size={14} className="text-stone-400" />}
                          <span className={`text-sm font-medium ${
                            healthColor === "emerald" ? "text-emerald-400" :
                            healthColor === "amber" ? "text-amber-300" : "text-stone-300"
                          }`}>{healthLabel}</span>
                        </div>
                        <span className="text-[11px] text-stone-500">
                          {webhookHealth.last24hCount} event(s) in last 24h
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-[11px]">
                        <div>
                          <div className="text-stone-400 uppercase tracking-wider mb-0.5">Last event</div>
                          <div className="text-stone-300">{fmtRelative(minutesSinceLast)}</div>
                        </div>
                        <div>
                          <div className="text-stone-400 uppercase tracking-wider mb-0.5">Last success</div>
                          <div className="text-stone-300">{fmtRelative(minutesSinceSuccess)}</div>
                        </div>
                        <div>
                          <div className="text-stone-400 uppercase tracking-wider mb-0.5">Cron safety net</div>
                          <div className="text-stone-300">{
                            webhookHealth.lastCronSyncAt
                              ? fmtRelative(Math.floor((Date.now() - new Date(webhookHealth.lastCronSyncAt).getTime()) / 60000))
                              : "never"
                          }</div>
                        </div>
                      </div>
                      <div className="mt-2 pt-2 border-t border-stone-700/60 text-[10px] text-stone-500">
                        Webhooks deliver QBO changes in seconds. If we miss one, the cron sync (every 30 min) reconciles all data — nothing is permanently lost.
                      </div>
                    </div>
                  );
                })()}

                {/* Recent webhook events */}
                {webhookHealth.recentEvents?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {webhookHealth.recentEvents.slice(0, 5).map((ev: any) => (
                      <div key={ev.id} className="flex items-center gap-2 text-[11px] py-1 px-2 rounded hover:bg-stone-800/50">
                        {ev.status === "received" ? <CheckCircle size={11} className="text-emerald-500" /> :
                         ev.status === "error" ? <XCircle size={11} className="text-rose-500" /> :
                         <AlertTriangle size={11} className="text-amber-500" />}
                        <span className="text-stone-500 w-28">
                          {new Date(ev.receivedAt).toLocaleString("en-IE", {
                            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                          })}
                        </span>
                        <span className="text-stone-300">{ev.entityCount} change(s)</span>
                        <span className="text-stone-400 truncate">
                          {ev.entities?.map((e: any) => `${e.name}#${e.id}(${e.operation})`).join(", ")}
                        </span>
                        {ev.errorMessage && <span className="ml-auto text-rose-400">{ev.errorMessage}</span>}
                        {ev.processingMs && !ev.errorMessage && (
                          <span className="ml-auto text-stone-400">{ev.processingMs}ms</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Sync history */}
            {syncHistory.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
                  Sync history
                </div>
                <div className="space-y-1.5">
                  {syncHistory.slice(0, 8).map((log: any) => {
                    const reconciled = Math.abs(log.difference || 0) < 1;
                    return (
                      <div
                        key={log.id}
                        className="flex items-center gap-3 text-sm py-1.5 border-b border-stone-800 last:border-0"
                      >
                        {log.status === "success" ? (
                          <CheckCircle size={14} className={reconciled ? "text-emerald-500" : "text-amber-500"} />
                        ) : (
                          <XCircle size={14} className="text-rose-500" />
                        )}
                        <span className="text-stone-500 text-[12px] w-36">
                          {new Date(log.syncedAt).toLocaleString("en-IE", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {log.status === "success" ? (
                          <>
                            <span className="text-stone-400 text-[12px]">
                              {log.invoicesCreated} new · {log.invoicesUpdated} updated · {log.invoicesClosed} closed
                            </span>
                            <span
                              className={`ml-auto text-[12px] font-medium tabular-nums ${
                                reconciled ? "text-emerald-400" : "text-amber-400"
                              }`}
                            >
                              {reconciled ? "✓ Reconciled" : `Δ ${fmt.money(log.difference || 0, ccy)}`}
                            </span>
                            <span className="text-stone-400 text-[11px]">
                              {log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : ""}
                            </span>
                          </>
                        ) : (
                          <span className="text-rose-600 text-[12px] truncate">{log.errorMessage}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Not connected */
          <div className="space-y-5">
            <p className="text-sm text-stone-400 leading-relaxed">
              Connect QuickBooks Online to automatically sync your customers and outstanding
              invoices. Changes in QBO — new invoices, payments, credits — flow into Ledger
              in real time via webhooks, with a 30-minute cron safety net.
            </p>

            {/* Feature bullets */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { icon: <RefreshCw size={13} />, text: "Automatic two-way sync" },
                { icon: <Check size={13} />,      text: "Invoices close when paid in QBO" },
                { icon: <Database size={13} />,   text: "Customers & contacts imported" },
                { icon: <Clock size={13} />,      text: "Real-time webhooks + cron backup" },
              ].map(({ icon, text }) => (
                <div key={text} className="flex items-center gap-2 text-[13px] text-stone-400">
                  <span className="text-emerald-500 shrink-0">{icon}</span>
                  {text}
                </div>
              ))}
            </div>

            <Button icon={Link2} onClick={() => (window.location.href = "/api/qbo")}>
              Connect QuickBooks Online
            </Button>
          </div>
        )}
      </Card>

      {/* Data Tools */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Database size={16} className="text-stone-400" />
          <h3 className="text-sm font-semibold text-white">Data tools</h3>
        </div>

        <div className="space-y-4">
          {/* Backfill inactive */}
          <div className="pb-4 border-b border-stone-800">
            <div className="text-sm font-medium text-white mb-1">Mark inactive — no open AR</div>
            <div className="text-[12px] text-stone-500 mb-3">
              Marks customers and projects as <strong>Inactive</strong> if they have no open invoices or unapplied credit memos.
              This runs automatically on every QBO sync. Use this to backfill existing records.
            </div>
            <Button size="sm" variant="secondary" onClick={handleBackfillInactive} disabled={backfillingInactive}>
              {backfillingInactive ? (
                <span className="flex items-center gap-2"><Loader size={14} className="animate-spin" />Running…</span>
              ) : (
                <span className="flex items-center gap-2"><RefreshCw size={14} />Mark inactive with no open AR</span>
              )}
            </Button>
            {backfillInactiveResult && (
              <div className="mt-2 bg-emerald-500/10 ring-1 ring-emerald-500/30 rounded-md px-3 py-2 text-sm text-emerald-400 flex items-center gap-2">
                <Check size={14} className="text-emerald-400 shrink-0" />
                <span>
                  Marked <strong>{backfillInactiveResult.customersDeactivated}</strong> customer{backfillInactiveResult.customersDeactivated !== 1 ? "s" : ""} and{" "}
                  <strong>{backfillInactiveResult.projectsDeactivated}</strong> project{backfillInactiveResult.projectsDeactivated !== 1 ? "s" : ""} inactive
                </span>
              </div>
            )}
          </div>

          {/* Tip */}
          <div className="text-[12px] text-stone-400 leading-relaxed">
            More data tools (re-sync, export, field mapping) will appear here as features are added.
          </div>
        </div>
      </Card>
    </div>
  );
}
