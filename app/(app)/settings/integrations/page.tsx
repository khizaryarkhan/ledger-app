"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useData } from "@/components/data-provider";
import { Card, Button, Badge } from "@/components/ui";
import {
  ChevronLeft, Link2, Unlink, RefreshCw, Check, AlertTriangle, Loader,
  CheckCircle, XCircle, Clock, Database, Mail, Server, ChevronDown, ChevronUp,
} from "lucide-react";
import { fmt } from "@/lib/format";

export default function IntegrationsSettingsPage() {
  const { customers, invoices, refresh, toast, orgSettings } = useData() as any;
  const { data: session } = useSession();
  const ccy: string = orgSettings?.currency ?? "EUR";
  const searchParams = useSearchParams();
  const userEmail = (session?.user?.email) || "";

  // QBO
  const [qboStatus, setQboStatus] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [syncHistory, setSyncHistory] = useState<any[]>([]);
  const [disconnecting, setDisconnecting] = useState(false);

  // Gmail
  const [gmailStatus, setGmailStatus] = useState<any>(null);
  const [gmailDisconnecting, setGmailDisconnecting] = useState(false);

  // Microsoft
  const [msStatus, setMsStatus] = useState<any>(null);
  const [msDisconnecting, setMsDisconnecting] = useState(false);

  // SMTP (inline form)
  const [smtpStatus, setSmtpStatus] = useState<any>(null);
  const [showSmtpForm, setShowSmtpForm] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [smtpForm, setSmtpForm] = useState({
    host: "mail-eu.smtp2go.com", port: "2525",
    user: "", pass: "", fromEmail: "", fromName: "",
    ccEmail: "", ccEnabled: false,
  });

  const loadSmtp = () =>
    fetch("/api/org/smtp").then(r => r.json()).then(data => {
      setSmtpStatus(data);
      if (data?.settings) {
        setSmtpForm(f => ({
          ...f,
          host:      data.settings.host      || f.host,
          port:      String(data.settings.port || f.port),
          user:      data.settings.user      || "",
          fromEmail: data.settings.fromEmail || "",
          fromName:  data.settings.fromName  || "",
          ccEmail:   data.settings.ccEmail   || "",
          ccEnabled: data.settings.ccEnabled ?? false,
        }));
      }
    }).catch(() => setSmtpStatus({ configured: false }));

  const handleSmtpSave = async () => {
    setSavingSmtp(true);
    try {
      const payload: any = {
        ...smtpForm, port: parseInt(smtpForm.port),
        ccEmail: smtpForm.ccEnabled ? smtpForm.ccEmail : "",
        ccEnabled: smtpForm.ccEnabled,
      };
      if (!smtpForm.pass && smtpStatus?.configured) {
        delete payload.pass;
        payload.keepExistingPass = true;
      }
      const res = await fetch("/api/org/smtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || "Failed to save", "error"); return; }
      toast("SMTP settings saved");
      setShowSmtpForm(false);
      await loadSmtp();
    } finally {
      setSavingSmtp(false);
    }
  };

  const handleSmtpDelete = async () => {
    await fetch("/api/org/smtp", { method: "DELETE" });
    setSmtpStatus({ configured: false, settings: null });
    setSmtpForm({ host: "mail-eu.smtp2go.com", port: "2525", user: "", pass: "", fromEmail: "", fromName: "", ccEmail: "", ccEnabled: false });
    toast("SMTP settings removed");
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: userEmail, subject: "Ledger — Email Test", body: "This is a test email. Your email transport is configured correctly." }),
      });
      const data = await res.json();
      if (res.ok) setTestResult({ ok: true, message: `Test sent to ${userEmail} via ${data.transport || "smtp"}` });
      else setTestResult({ ok: false, message: data.error || "Send failed" });
    } catch {
      setTestResult({ ok: false, message: "Request failed" });
    } finally {
      setTestingEmail(false);
    }
  };

  // Backfill paid-at dates
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ backfilled: number; skipped: number } | null>(null);

  // Backfill inactive
  const [backfillingInactive, setBackfillingInactive] = useState(false);
  const [backfillInactiveResult, setBackfillInactiveResult] = useState<{ customersDeactivated: number; projectsDeactivated: number } | null>(null);

  // Demo data
  const [seeding, setSeeding] = useState(false);

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
    fetch("/api/gmail?status=1").then(r => r.json()).then(setGmailStatus).catch(() => setGmailStatus({ connected: false }));
    fetch("/api/microsoft?status=1").then(r => r.json()).then(setMsStatus).catch(() => setMsStatus({ connected: false }));
    loadSmtp();
    loadWebhookHealth();
  }, []);

  useEffect(() => {
    const qbo       = searchParams.get("qbo");
    const gmail     = searchParams.get("gmail");
    const microsoft = searchParams.get("microsoft");
    if (qbo === "connected") {
      toast("QuickBooks connected!");
      fetch("/api/qbo/sync").then(r => r.json()).then(setQboStatus);
    } else if (qbo === "error") {
      toast(`QBO error: ${searchParams.get("reason")}`, "error");
    }
    if (gmail === "connected") {
      toast("Gmail connected!");
      fetch("/api/gmail?status=1").then(r => r.json()).then(setGmailStatus);
    } else if (gmail === "error") {
      toast(`Gmail error: ${searchParams.get("reason")}`, "error");
    }
    if (microsoft === "connected") {
      toast("Microsoft / Outlook connected!");
      fetch("/api/microsoft?status=1").then(r => r.json()).then(setMsStatus);
    } else if (microsoft === "error") {
      toast(`Microsoft error: ${searchParams.get("reason")}`, "error");
    }
  }, [searchParams]);

  const handleGmailDisconnect = async () => {
    setGmailDisconnecting(true);
    try {
      await fetch("/api/gmail/disconnect", { method: "POST" });
      setGmailStatus({ connected: false });
      toast("Gmail disconnected");
    } finally {
      setGmailDisconnecting(false);
    }
  };

  const handleMsDisconnect = async () => {
    setMsDisconnecting(true);
    try {
      await fetch("/api/microsoft/disconnect", { method: "POST" });
      setMsStatus({ connected: false });
      toast("Microsoft disconnected");
    } finally {
      setMsDisconnecting(false);
    }
  };

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

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      const data = await res.json();
      if (!res.ok) toast(data.error || "Seed failed", "error");
      else {
        toast(`Loaded ${data.customers} customers, ${data.invoices} invoices`);
        await refresh();
      }
    } catch {
      toast("Seed failed", "error");
    } finally {
      setSeeding(false);
    }
  };

  const isReconciled = syncResult && Math.abs(syncResult.difference || 0) < 1;

  return (
    <div className="p-6 max-w-[860px] mx-auto">
      {/* Back + header */}
      <div className="mb-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-900 mb-3 transition-colors"
        >
          <ChevronLeft size={14} /> Settings
        </Link>
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Integrations</h1>
        <p className="text-sm text-stone-500 mt-1">Connect external services and manage data sync.</p>
      </div>

      {/* QuickBooks Online */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Link2 size={16} className="text-stone-600" />
          <h3 className="text-sm font-semibold text-stone-900">QuickBooks Online</h3>
          {qboStatus?.connected && <Badge variant="green" size="sm">Connected</Badge>}
        </div>

        {qboStatus === null ? (
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <Loader size={14} className="animate-spin" /> Checking…
          </div>
        ) : qboStatus.connected ? (
          <div className="space-y-4">
            {/* Connected banner */}
            <div className="bg-emerald-50 ring-1 ring-emerald-200 rounded-md p-3 flex items-center gap-2">
              <Check size={15} className="text-emerald-600" />
              <div>
                <div className="text-sm font-medium text-emerald-900">
                  Connected to {qboStatus.companyName}
                </div>
                <div className="text-[11px] text-emerald-700 mt-0.5">Realm ID: {qboStatus.realmId}</div>
              </div>
            </div>

            <div className="text-sm text-stone-600">
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
              <div className="rounded-md ring-1 ring-stone-200 overflow-hidden">
                <div className="px-3 py-2 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
                  <div className="text-xs font-semibold text-stone-700 uppercase tracking-wider">
                    QBO vs Ledger
                  </div>
                  <div className="text-[10px] text-stone-500">
                    Checked {new Date(verifyResult.checkedAt).toLocaleString("en-IE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-[11px] text-stone-500 uppercase">
                    <tr className="border-b border-stone-100">
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
                        <tr key={row.entity} className="border-b border-stone-50 last:border-0">
                          <td className="px-3 py-2 text-stone-800">{row.entity}</td>
                          <td className="px-3 py-2 text-right text-stone-600 tabular-nums">
                            {row.qbo === -1 ? "—" : row.qbo.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right text-stone-600 tabular-nums">
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
                <div className="px-3 py-2 bg-stone-50 border-t border-stone-100 text-[11px] text-stone-500 flex items-center justify-between">
                  <span>Payment applications stored: <span className="font-medium text-stone-700">{verifyResult.paymentApplications?.toLocaleString() ?? 0}</span></span>
                  <span>
                    {verifyResult.rows.every((r: any) => r.qbo === r.ledger)
                      ? <span className="text-emerald-700 font-medium">✓ Ledger matches QBO</span>
                      : <span className="text-amber-700">Run Sync to pull missing data</span>}
                  </span>
                </div>
              </div>
            )}

            {/* AR verification result */}
            {arVerifyResult && (
              <div className="rounded-md ring-1 ring-stone-200 overflow-hidden">
                <div className="px-3 py-2 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
                  <div className="text-xs font-semibold text-stone-700 uppercase tracking-wider">AR Total — QBO vs Ledger</div>
                  <div className="text-[10px] text-stone-500">Checked {new Date(arVerifyResult.checkedAt).toLocaleString("en-IE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                </div>
                <table className="w-full text-[12px]">
                  <thead className="text-[10px] text-stone-500 uppercase">
                    <tr className="border-b border-stone-100">
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
                        <tr key={row.currency} className="border-b border-stone-50 last:border-0">
                          <td className="px-2 py-2 font-mono text-stone-700">{row.currency}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-600">{fmt.money(row.qbo.invoices, row.currency)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-600">{fmt.money(row.qbo.credits, row.currency)}</td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold text-stone-900">{fmt.money(row.qbo.net, row.currency)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-600">{fmt.money(row.ledger.invoices, row.currency)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-600">{fmt.money(row.ledger.credits, row.currency)}</td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold text-stone-900">{fmt.money(row.ledger.net, row.currency)}</td>
                          <td className={`px-2 py-2 text-right tabular-nums font-semibold ${inSync ? "text-emerald-600" : "text-rose-600"}`}>
                            {inSync ? "✓" : fmt.money(diff, row.currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="px-3 py-2 bg-stone-50 border-t border-stone-100 text-[11px] text-stone-500 flex items-center justify-between">
                  <span>QBO open: {arVerifyResult.qbo.openInvoiceCount} invoices, {arVerifyResult.qbo.openCmCount} credit memos</span>
                  <span>
                    {Math.abs(arVerifyResult.difference) < 0.50
                      ? <span className="text-emerald-700 font-medium">✓ AR totals match QBO</span>
                      : <span className="text-amber-700">Ledger AR differs by {fmt.money(Math.abs(arVerifyResult.difference), "EUR")}</span>}
                  </span>
                </div>
              </div>
            )}

            {/* Backfill result */}
            {backfillResult && (
              <div className="bg-emerald-50 ring-1 ring-emerald-200 rounded-md px-3 py-2 text-sm text-emerald-800 flex items-center gap-2">
                <Check size={14} className="text-emerald-600 shrink-0" />
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
                    isReconciled ? "bg-emerald-50 ring-emerald-200" : "bg-amber-50 ring-amber-200"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    {isReconciled ? (
                      <CheckCircle size={16} className="text-emerald-600" />
                    ) : (
                      <AlertTriangle size={16} className="text-amber-600" />
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
                      <div key={label} className="bg-white/60 rounded-md p-3">
                        <div className="text-[11px] text-stone-500 mb-1">{label}</div>
                        <div
                          className={`text-lg font-semibold tabular-nums ${
                            colored
                              ? isReconciled
                                ? "text-emerald-700"
                                : "text-amber-700"
                              : ""
                          }`}
                        >
                          {fmt.money(value, ccy)}
                        </div>
                        <div className="text-[10px] text-stone-400 mt-0.5">{note}</div>
                      </div>
                    ))}
                  </div>
                  {!isReconciled && (
                    <div className="mt-3 text-xs text-amber-800 bg-amber-100 rounded p-2">
                      A variance may be caused by: Journal Entries hitting AR, retainer deposits, write-offs,
                      or invoices in a currency not yet synced. Check QBO AR Aging report.
                    </div>
                  )}
                </div>

                {/* Sync stats */}
                <div className="bg-stone-50 ring-1 ring-stone-200 rounded-md p-3">
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
                        <div className="text-xl font-semibold text-stone-900">{value}</div>
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
                    className="text-[11px] text-stone-400 hover:text-stone-700 flex items-center gap-1">
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
                      healthColor === "emerald" ? "bg-emerald-50 ring-emerald-200" :
                      healthColor === "amber" ? "bg-amber-50 ring-amber-200" :
                      "bg-stone-50 ring-stone-200"
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {healthColor === "emerald" ? <CheckCircle size={14} className="text-emerald-600" /> :
                           healthColor === "amber" ? <AlertTriangle size={14} className="text-amber-600" /> :
                           <Clock size={14} className="text-stone-400" />}
                          <span className={`text-sm font-medium ${
                            healthColor === "emerald" ? "text-emerald-800" :
                            healthColor === "amber" ? "text-amber-800" : "text-stone-700"
                          }`}>{healthLabel}</span>
                        </div>
                        <span className="text-[11px] text-stone-500">
                          {webhookHealth.last24hCount} event(s) in last 24h
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-[11px]">
                        <div>
                          <div className="text-stone-400 uppercase tracking-wider mb-0.5">Last event</div>
                          <div className="text-stone-700">{fmtRelative(minutesSinceLast)}</div>
                        </div>
                        <div>
                          <div className="text-stone-400 uppercase tracking-wider mb-0.5">Last success</div>
                          <div className="text-stone-700">{fmtRelative(minutesSinceSuccess)}</div>
                        </div>
                        <div>
                          <div className="text-stone-400 uppercase tracking-wider mb-0.5">Cron safety net</div>
                          <div className="text-stone-700">{
                            webhookHealth.lastCronSyncAt
                              ? fmtRelative(Math.floor((Date.now() - new Date(webhookHealth.lastCronSyncAt).getTime()) / 60000))
                              : "never"
                          }</div>
                        </div>
                      </div>
                      <div className="mt-2 pt-2 border-t border-stone-200/60 text-[10px] text-stone-500">
                        Webhooks deliver QBO changes in seconds. If we miss one, the cron sync (every 30 min) reconciles all data — nothing is permanently lost.
                      </div>
                    </div>
                  );
                })()}

                {/* Recent webhook events */}
                {webhookHealth.recentEvents?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {webhookHealth.recentEvents.slice(0, 5).map((ev: any) => (
                      <div key={ev.id} className="flex items-center gap-2 text-[11px] py-1 px-2 rounded hover:bg-stone-50">
                        {ev.status === "received" ? <CheckCircle size={11} className="text-emerald-500" /> :
                         ev.status === "error" ? <XCircle size={11} className="text-rose-500" /> :
                         <AlertTriangle size={11} className="text-amber-500" />}
                        <span className="text-stone-500 w-28">
                          {new Date(ev.receivedAt).toLocaleString("en-IE", {
                            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                          })}
                        </span>
                        <span className="text-stone-700">{ev.entityCount} change(s)</span>
                        <span className="text-stone-400 truncate">
                          {ev.entities?.map((e: any) => `${e.name}#${e.id}(${e.operation})`).join(", ")}
                        </span>
                        {ev.errorMessage && <span className="ml-auto text-rose-600">{ev.errorMessage}</span>}
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
                        className="flex items-center gap-3 text-sm py-1.5 border-b border-stone-100 last:border-0"
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
                            <span className="text-stone-600 text-[12px]">
                              {log.invoicesCreated} new · {log.invoicesUpdated} updated · {log.invoicesClosed} closed
                            </span>
                            <span
                              className={`ml-auto text-[12px] font-medium tabular-nums ${
                                reconciled ? "text-emerald-700" : "text-amber-700"
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
          <div className="space-y-3">
            <div className="text-sm text-stone-600">
              Connect QuickBooks Online to sync customers and outstanding invoices automatically.
            </div>
            <div className="bg-amber-50 ring-1 ring-amber-200 rounded-md p-3 text-sm text-amber-800">
              <div className="font-medium mb-1">Required Vercel env vars:</div>
              <div className="font-mono text-[12px] space-y-0.5">
                <div>QBO_CLIENT_ID</div>
                <div>QBO_CLIENT_SECRET</div>
                <div>QBO_REDIRECT_URI = https://ledger-app-alpha-roan.vercel.app/api/qbo/callback</div>
              </div>
            </div>
            <Button icon={Link2} onClick={() => (window.location.href = "/api/qbo")}>
              Connect QuickBooks Online
            </Button>
          </div>
        )}
      </Card>

      {/* ── Email Integrations ───────────────────────────────────── */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Mail size={16} className="text-stone-600" />
          <h3 className="text-sm font-semibold text-stone-900">Email Integrations</h3>
          {gmailStatus?.connected && <Badge variant="green" size="sm">Gmail active</Badge>}
          {msStatus?.connected    && <Badge variant="green" size="sm">Microsoft active</Badge>}
          {!gmailStatus?.connected && !msStatus?.connected && smtpStatus?.configured && (
            <Badge variant="neutral" size="sm">SMTP active</Badge>
          )}
        </div>
        <p className="text-[12px] text-stone-500 mb-5">
          Choose one transport for outbound email. Connect Gmail or Microsoft, or configure SMTP as fallback.
        </p>

        {(() => {
          const oauthActive = gmailStatus?.connected || msStatus?.connected;
          const loading     = gmailStatus === null || msStatus === null || smtpStatus === null;

          if (loading) {
            return (
              <div className="flex items-center gap-2 text-sm text-stone-500">
                <Loader size={14} className="animate-spin" /> Checking…
              </div>
            );
          }

          return (
            <div className="space-y-3">

              {/* ── Gmail row ── */}
              <div className={`rounded-lg ring-1 p-4 transition-colors ${
                gmailStatus.connected ? "ring-emerald-200 bg-emerald-50" : "ring-stone-200 bg-white"
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${
                    gmailStatus.connected ? "bg-emerald-100" : "bg-stone-100"
                  }`}>
                    <Mail size={15} className={gmailStatus.connected ? "text-emerald-600" : "text-stone-500"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-stone-900">Gmail</span>
                      {gmailStatus.connected && <Badge variant="green" size="sm">Active</Badge>}
                    </div>
                    <div className="text-[12px] text-stone-500 mt-0.5">
                      {gmailStatus.connected
                        ? <>Sending from <span className="font-mono text-stone-700">{gmailStatus.email}</span> · Sent mail appears in Gmail</>
                        : "Send via your Google account using OAuth"}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {gmailStatus.connected ? (
                      <Button variant="ghost" size="sm" onClick={handleGmailDisconnect} disabled={gmailDisconnecting}>
                        <Unlink size={13} className="mr-1" />
                        {gmailDisconnecting ? "Disconnecting…" : "Disconnect"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={oauthActive}
                        onClick={() => (window.location.href = "/api/gmail")}
                        title={oauthActive ? "Disconnect the active transport first" : ""}
                      >
                        Connect Gmail
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Microsoft row ── */}
              <div className={`rounded-lg ring-1 p-4 transition-colors ${
                msStatus.connected ? "ring-emerald-200 bg-emerald-50" : "ring-stone-200 bg-white"
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${
                    msStatus.connected ? "bg-emerald-100" : "bg-stone-100"
                  }`}>
                    <Mail size={15} className={msStatus.connected ? "text-emerald-600" : "text-stone-500"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-stone-900">Microsoft / Outlook</span>
                      {msStatus.connected && <Badge variant="green" size="sm">Active</Badge>}
                    </div>
                    <div className="text-[12px] text-stone-500 mt-0.5">
                      {msStatus.connected
                        ? <>Sending from <span className="font-mono text-stone-700">{msStatus.email}</span> · Sent mail appears in Outlook</>
                        : "Send via Office 365 or personal Microsoft account"}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {msStatus.connected ? (
                      <Button variant="ghost" size="sm" onClick={handleMsDisconnect} disabled={msDisconnecting}>
                        <Unlink size={13} className="mr-1" />
                        {msDisconnecting ? "Disconnecting…" : "Disconnect"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={oauthActive}
                        onClick={() => (window.location.href = "/api/microsoft")}
                        title={oauthActive ? "Disconnect the active transport first" : ""}
                      >
                        Connect Microsoft
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── SMTP row ── */}
              <div className={`rounded-lg ring-1 transition-colors ${
                !oauthActive && smtpStatus.configured ? "ring-stone-300 bg-stone-50" : "ring-stone-200 bg-white"
              }`}>
                <div className="flex items-center gap-3 p-4">
                  <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${
                    !oauthActive && smtpStatus.configured ? "bg-stone-200" : "bg-stone-100"
                  }`}>
                    <Server size={15} className="text-stone-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-stone-900">SMTP</span>
                      {smtpStatus.configured && oauthActive  && <Badge variant="neutral" size="sm">Fallback</Badge>}
                      {smtpStatus.configured && !oauthActive && <Badge variant="neutral" size="sm">Active</Badge>}
                    </div>
                    <div className="text-[12px] text-stone-500 mt-0.5">
                      {smtpStatus.configured
                        ? <>{oauthActive ? "Configured as fallback — " : "Sending from "}<span className="font-mono text-stone-700">{smtpStatus.settings?.fromEmail}</span></>
                        : "Configure your own SMTP server (e.g. SMTP2Go, SendGrid)"}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <button
                      onClick={() => setShowSmtpForm(v => !v)}
                      className="flex items-center gap-1 text-[12px] font-medium text-stone-600 hover:text-stone-900 transition-colors"
                    >
                      {smtpStatus.configured ? "Edit" : "Configure"}
                      {showSmtpForm ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </div>
                </div>

                {/* SMTP inline form */}
                {showSmtpForm && (
                  <div className="border-t border-stone-200 px-4 pb-4 pt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">SMTP Host</label>
                        <input value={smtpForm.host} onChange={e => setSmtpForm(p => ({ ...p, host: e.target.value }))}
                          placeholder="mail-eu.smtp2go.com"
                          className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Port</label>
                        <input value={smtpForm.port} onChange={e => setSmtpForm(p => ({ ...p, port: e.target.value }))}
                          placeholder="2525"
                          className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">SMTP Username</label>
                      <input
                        value={smtpForm.user}
                        onChange={e => setSmtpForm(p => ({ ...p, user: e.target.value }))}
                        placeholder="your-smtp-username"
                        autoComplete="off"
                        className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                        SMTP Password{" "}
                        {smtpStatus.configured && <span className="text-stone-400 normal-case font-normal">(leave blank to keep existing)</span>}
                      </label>
                      <input
                        type="password"
                        value={smtpForm.pass}
                        onChange={e => setSmtpForm(p => ({ ...p, pass: e.target.value }))}
                        placeholder={smtpStatus.configured ? "leave blank to keep existing" : "your-smtp-password"}
                        autoComplete="new-password"
                        className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">From Email *</label>
                        <input value={smtpForm.fromEmail} onChange={e => setSmtpForm(p => ({ ...p, fromEmail: e.target.value }))}
                          placeholder="ar@yourcompany.com"
                          className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">From Name</label>
                        <input value={smtpForm.fromName} onChange={e => setSmtpForm(p => ({ ...p, fromName: e.target.value }))}
                          placeholder="Accounts Receivable"
                          className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
                      </div>
                    </div>
                    {/* CC toggle */}
                    <div className="flex items-center justify-between pt-1">
                      <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Default CC on every email</label>
                      <button type="button" onClick={() => setSmtpForm(p => ({ ...p, ccEnabled: !p.ccEnabled }))}
                        className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${smtpForm.ccEnabled ? "bg-stone-900" : "bg-stone-200"}`}>
                        <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${smtpForm.ccEnabled ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </div>
                    {smtpForm.ccEnabled && (
                      <input type="email" value={smtpForm.ccEmail} onChange={e => setSmtpForm(p => ({ ...p, ccEmail: e.target.value }))}
                        placeholder="e.g. accounts@yourcompany.com"
                        className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
                    )}
                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      <Button onClick={handleSmtpSave} disabled={savingSmtp || !smtpForm.host || !smtpForm.user || !smtpForm.fromEmail || (!smtpForm.pass && !smtpStatus.configured)}>
                        {savingSmtp ? "Saving…" : "Save SMTP settings"}
                      </Button>
                      {smtpStatus.configured && (
                        <Button variant="secondary" size="sm" onClick={handleTestEmail} disabled={testingEmail}>
                          {testingEmail ? "Sending…" : "Send test email"}
                        </Button>
                      )}
                      {smtpStatus.configured && (
                        <Button variant="ghost" size="sm" onClick={handleSmtpDelete} className="text-rose-600 hover:text-rose-700">
                          Remove SMTP
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setShowSmtpForm(false)}>Cancel</Button>
                    </div>
                    {testResult && (
                      <div className={`text-xs px-3 py-2 rounded ${testResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                        {testResult.message}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Lock hint */}
              {oauthActive && (
                <p className="text-[11px] text-stone-400 pt-1">
                  Disconnect {gmailStatus.connected ? "Gmail" : "Microsoft"} to switch to a different transport.
                </p>
              )}

            </div>
          );
        })()}
      </Card>

      {/* Data Tools */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Database size={16} className="text-stone-600" />
          <h3 className="text-sm font-semibold text-stone-900">Data tools</h3>
        </div>

        <div className="space-y-4">
          {/* Demo data */}
          <div className="pb-4 border-b border-stone-100">
            <div className="text-sm font-medium text-stone-800 mb-1">Demo data</div>
            <div className="text-[12px] text-stone-500 mb-3">
              Currently <strong>{customers.length}</strong> customers and{" "}
              <strong>{invoices.length}</strong> invoices in the system.
            </div>
            <div className="bg-amber-50 ring-1 ring-amber-200 rounded-md p-2.5 text-xs text-amber-800 mb-3 flex items-start gap-2">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              Only click once — calling twice creates duplicates.
            </div>
            <Button size="sm" onClick={handleSeed} disabled={seeding}>
              {seeding ? "Loading…" : "Load demo data"}
            </Button>
          </div>

          {/* Backfill inactive */}
          <div className="pb-4 border-b border-stone-100">
            <div className="text-sm font-medium text-stone-800 mb-1">Mark inactive — no open AR</div>
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
              <div className="mt-2 bg-emerald-50 ring-1 ring-emerald-200 rounded-md px-3 py-2 text-sm text-emerald-800 flex items-center gap-2">
                <Check size={14} className="text-emerald-600 shrink-0" />
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
