"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useData } from "@/components/data-provider";
import { Card, Button, Badge } from "@/components/ui";
import { User, Database, RefreshCw, Link2, Unlink, Check, AlertTriangle, Loader, Mail, Clock, CheckCircle, XCircle, Users, MapPin, Plus, Trash2, Palette, Calendar, KeyRound, Eye, EyeOff, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { fmt } from "@/lib/format";

export default function SettingsPage() {
  const { data: session } = useSession();
  const { refresh, toast, customers, invoices, reps, regions, orgSettings, addRep, deleteRep, addRegion, deleteRegion, updateOrgSettings } = useData();
  const searchParams = useSearchParams();

  const [seeding, setSeeding] = useState(false);
  const [qboStatus, setQboStatus] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [syncHistory, setSyncHistory] = useState<any[]>([]);
  const [disconnecting, setDisconnecting] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [smtpStatus, setSmtpStatus] = useState<any>(null);
  const [showSmtpForm, setShowSmtpForm] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [smtpForm, setSmtpForm] = useState({ host: "mail-eu.smtp2go.com", port: "2525", user: "", pass: "", fromEmail: "", fromName: "" });

  const role = (session?.user as any)?.role;
  const isAdmin = role === "company_admin" || role === "super_admin";
  const [brandingForm, setBrandingForm] = useState({ logoUrl: "", displayName: "" });
  const [savingBranding, setSavingBranding] = useState(false);
  const [dateFormat, setDateFormat] = useState("DD MMM YYYY");
  const [savingDateFormat, setSavingDateFormat] = useState(false);
  const [newRepName, setNewRepName] = useState("");
  const [newRepEmail, setNewRepEmail] = useState("");
  const [addingRep, setAddingRep] = useState(false);
  const [repSearch, setRepSearch] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ backfilled: number; skipped: number } | null>(null);
  const [newRegionName, setNewRegionName] = useState("");
  const [addingRegion, setAddingRegion] = useState(false);

  // Rep login management
  const [repLogins, setRepLogins] = useState<Record<string, { hasLogin: boolean; email: string | null; status: string | null }>>({});
  const [repLoginModal, setRepLoginModal] = useState<{ repId: string; repName: string; hasLogin: boolean } | null>(null);
  const [repLoginPassword, setRepLoginPassword] = useState("");
  const [repLoginConfirm, setRepLoginConfirm]   = useState("");
  const [repLoginSaving, setRepLoginSaving]     = useState(false);
  const [repLoginError, setRepLoginError]       = useState("");
  const [repLoginSuccess, setRepLoginSuccess]   = useState("");
  const [showRepPassword, setShowRepPassword]   = useState(false);

  const userName = session?.user?.name || "";
  const userEmail = session?.user?.email || "";
  const initials = userName.split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase();

  useEffect(() => {
    fetch("/api/qbo/sync").then(r => r.json()).then(setQboStatus).catch(() => setQboStatus({ connected: false }));
    fetch("/api/org/smtp").then(r => r.json()).then(setSmtpStatus).catch(() => setSmtpStatus({ configured: false }));
    fetch("/api/qbo/history").then(r => r.json()).then(setSyncHistory).catch(() => {});
  }, []);

  // Load rep login statuses when reps change
  useEffect(() => {
    if (!reps || reps.length === 0 || !isAdmin) return;
    const loadLogins = async () => {
      const entries = await Promise.all(
        (reps as any[]).map(async (r: any) => {
          try {
            const res = await fetch(`/api/admin/reps/${r.id}/login`);
            if (!res.ok) return [r.id, { hasLogin: false, email: null, status: null }];
            return [r.id, await res.json()];
          } catch {
            return [r.id, { hasLogin: false, email: null, status: null }];
          }
        })
      );
      setRepLogins(Object.fromEntries(entries));
    };
    loadLogins();
  }, [reps, isAdmin]);

  const handleRepLoginSave = async () => {
    if (!repLoginModal) return;
    if (repLoginPassword.length < 8) { setRepLoginError("Password must be at least 8 characters"); return; }
    if (repLoginPassword !== repLoginConfirm) { setRepLoginError("Passwords do not match"); return; }
    setRepLoginSaving(true);
    setRepLoginError("");
    setRepLoginSuccess("");
    try {
      const res = await fetch(`/api/admin/reps/${repLoginModal.repId}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: repLoginPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setRepLoginError(data.error || "Failed to save"); return; }
      setRepLoginSuccess(data.created
        ? `Login created! Rep can log in with: ${data.email}`
        : `Password updated for: ${data.email}`);
      // Refresh login statuses
      setRepLogins(prev => ({ ...prev, [repLoginModal.repId]: { hasLogin: true, email: data.email, status: "Active" } }));
      setRepLoginPassword(""); setRepLoginConfirm("");
    } finally {
      setRepLoginSaving(false);
    }
  };

  // Sync local branding/dateFormat state from orgSettings
  useEffect(() => {
    if (orgSettings) {
      setBrandingForm({ logoUrl: orgSettings.logoUrl || "", displayName: orgSettings.displayName || "" });
      setDateFormat(orgSettings.dateFormat || "DD MMM YYYY");
    }
  }, [orgSettings]);

  useEffect(() => {
    const qbo = searchParams.get("qbo");
    if (qbo === "connected") { toast("QuickBooks connected!"); fetch("/api/qbo/sync").then(r => r.json()).then(setQboStatus); }
    else if (qbo === "error") toast(`QBO error: ${searchParams.get("reason")}`, "error");

  }, [searchParams]);

  const handleSync = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const res = await fetch("/api/qbo/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast(data.error || "Sync failed", "error"); }
      else {
        setSyncResult(data.synced);
        const diff = data.synced.difference || 0;
        if (diff < 1) toast("Sync complete — AR reconciled ✓");
        else toast(`Sync complete — €${diff.toFixed(2)} variance, check reconciliation`, "info");
        await refresh();
        fetch("/api/qbo/history").then(r => r.json()).then(setSyncHistory).catch(() => {});
      }
    } catch (e) { toast("Sync failed", "error"); }
    finally { setSyncing(false); }
  };

  const handleQboDisconnect = async () => {
    setDisconnecting(true);
    try { await fetch("/api/qbo/disconnect", { method: "POST" }); setQboStatus({ connected: false }); setSyncResult(null); toast("QuickBooks disconnected"); }
    finally { setDisconnecting(false); }
  };

  const handleGmailDisconnect = async () => {
    setGmailDisconnecting(true);
    try { await fetch("/api/gmail/disconnect", { method: "POST" }); setGmailStatus({ connected: false }); toast("Gmail disconnected"); }
    finally { setGmailDisconnecting(false); }
  };

  const handleSmtpSave = async () => {
    setSavingSmtp(true);
    try {
      // If editing and password left blank, fetch existing password from server
      const payload: any = { ...smtpForm, port: parseInt(smtpForm.port) };
      if (!smtpForm.pass && smtpStatus?.configured) {
        // Don't send empty password — server will keep existing
        delete payload.pass;
        payload.keepExistingPass = true;
      }
      const res = await fetch("/api/org/smtp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || "Failed to save", "error"); return; }
      toast("Email settings saved");
      setShowSmtpForm(false);
      const r = await fetch("/api/org/smtp");
      if (r.ok) setSmtpStatus(await r.json());
    } finally { setSavingSmtp(false); }
  };

  const handleSmtpDelete = async () => {
    await fetch("/api/org/smtp", { method: "DELETE" });
    setSmtpStatus({ configured: false, settings: null });
    setSmtpForm({ host: "mail-eu.smtp2go.com", port: "2525", user: "", pass: "", fromEmail: "", fromName: "" });
    toast("Email settings removed");
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: userEmail,
          subject: "Ledger — SMTP Test Email",
          body: "This is a test email from your Ledger AR Collections CRM. SMTP2Go is configured correctly.",
        }),
      });
      const data = await res.json();
      if (res.ok) setTestResult({ ok: true, message: `Test email sent to ${userEmail}` });
      else setTestResult({ ok: false, message: data.error || "Send failed" });
    } catch (e) {
      setTestResult({ ok: false, message: "Request failed" });
    } finally {
      setTestingEmail(false);
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      const data = await res.json();
      if (!res.ok) toast(data.error || "Seed failed", "error");
      else { toast(`Loaded ${data.customers} customers, ${data.invoices} invoices`); await refresh(); }
    } catch (e) { toast("Seed failed", "error"); }
    finally { setSeeding(false); }
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await fetch("/api/qbo/backfill-paid-at", { method: "POST" });
      const data = await res.json();
      if (!res.ok) toast(data.error || "Backfill failed", "error");
      else { setBackfillResult(data); toast(`Backfilled ${data.backfilled} invoice${data.backfilled !== 1 ? "s" : ""}`); }
    } catch (e) { toast("Backfill failed", "error"); }
    finally { setBackfilling(false); }
  };

  const isReconciled = syncResult && Math.abs(syncResult.difference || 0) < 1;

  return (
    <div className="p-6 max-w-[900px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Settings</h1>
        <p className="text-sm text-stone-500 mt-1">Profile, integrations and data</p>
      </div>

      {/* Profile */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-4"><User size={16} className="text-stone-600" /><h3 className="text-sm font-semibold text-stone-900">Your profile</h3></div>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-stone-700 to-stone-900 flex items-center justify-center text-white text-lg font-semibold">{initials}</div>
          <div className="flex-1">
            <div className="text-base font-medium text-stone-900">{userName}</div>
            <div className="text-sm text-stone-500">{userEmail}</div>
            <div className="mt-1"><Badge variant={isAdmin ? "purple" : "neutral"} size="sm">{(session?.user as any)?.role || "User"}</Badge></div>
          </div>
        </div>
      </Card>

      {/* QuickBooks */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Link2 size={16} className="text-stone-600" />
          <h3 className="text-sm font-semibold text-stone-900">QuickBooks Online</h3>
          {qboStatus?.connected && <Badge variant="green" size="sm">Connected</Badge>}
        </div>

        {qboStatus === null ? (
          <div className="flex items-center gap-2 text-sm text-stone-500"><Loader size={14} className="animate-spin" /> Checking...</div>
        ) : qboStatus.connected ? (
          <div className="space-y-4">
            <div className="bg-emerald-50 ring-1 ring-emerald-200 rounded-md p-3 flex items-center gap-2">
              <Check size={15} className="text-emerald-600" />
              <div>
                <div className="text-sm font-medium text-emerald-900">Connected to {qboStatus.companyName}</div>
                <div className="text-[11px] text-emerald-700 mt-0.5">Realm ID: {qboStatus.realmId}</div>
              </div>
            </div>

            <div className="text-sm text-stone-600">
              Sync pulls all open invoices (Balance &gt; 0) and unapplied credits from QBO. Invoices paid in QBO auto-close in Ledger. Your collection notes, stages and tasks are never overwritten.
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={handleSync} disabled={syncing}>
                {syncing ? (
                  <span className="flex items-center gap-2"><Loader size={14} className="animate-spin" />Syncing from QuickBooks…</span>
                ) : (
                  <span className="flex items-center gap-2"><RefreshCw size={14} />Sync from QuickBooks</span>
                )}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleBackfill} disabled={backfilling || syncing}>
                {backfilling ? (
                  <span className="flex items-center gap-2"><Loader size={14} className="animate-spin" />Backfilling…</span>
                ) : (
                  <span className="flex items-center gap-2"><Clock size={14} />Backfill payment dates</span>
                )}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleQboDisconnect} disabled={disconnecting}>
                <Unlink size={14} className="mr-1.5" />{disconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
            {backfillResult && (
              <div className="bg-emerald-50 ring-1 ring-emerald-200 rounded-md px-3 py-2 text-sm text-emerald-800 flex items-center gap-2">
                <Check size={14} className="text-emerald-600 shrink-0" />
                <span>
                  Backfilled <strong>{backfillResult.backfilled}</strong> invoice{backfillResult.backfilled !== 1 ? "s" : ""} with payment dates
                  {backfillResult.skipped > 0 ? ` · ${backfillResult.skipped} skipped (no QBO payment found)` : ""}
                </span>
              </div>
            )}

            {/* Reconciliation panel */}
            {syncResult && (
              <div className="space-y-3">
                {/* AR Reconciliation */}
                <div className={`rounded-lg p-4 ring-1 ${isReconciled ? "bg-emerald-50 ring-emerald-200" : "bg-amber-50 ring-amber-200"}`}>
                  <div className="flex items-center gap-2 mb-3">
                    {isReconciled
                      ? <CheckCircle size={16} className="text-emerald-600" />
                      : <AlertTriangle size={16} className="text-amber-600" />}
                    <span className="text-sm font-semibold">
                      {isReconciled ? "AR Reconciled ✓" : "AR Variance — investigation needed"}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-white/60 rounded-md p-3">
                      <div className="text-[11px] text-stone-500 mb-1">QBO Total AR</div>
                      <div className="text-lg font-semibold tabular-nums">{fmt.money(syncResult.qboTotalAR)}</div>
                      <div className="text-[10px] text-stone-400 mt-0.5">From QBO open invoices</div>
                    </div>
                    <div className="bg-white/60 rounded-md p-3">
                      <div className="text-[11px] text-stone-500 mb-1">Ledger Total AR</div>
                      <div className="text-lg font-semibold tabular-nums">{fmt.money(syncResult.ledgerTotalAR)}</div>
                      <div className="text-[10px] text-stone-400 mt-0.5">Invoices in Ledger</div>
                    </div>
                    <div className="bg-white/60 rounded-md p-3">
                      <div className="text-[11px] text-stone-500 mb-1">Difference</div>
                      <div className={`text-lg font-semibold tabular-nums ${isReconciled ? "text-emerald-700" : "text-amber-700"}`}>
                        {fmt.money(syncResult.difference || 0)}
                      </div>
                      <div className="text-[10px] text-stone-400 mt-0.5">
                        {isReconciled ? "Fully reconciled" : "Check credits/JEs"}
                      </div>
                    </div>
                  </div>
                  {!isReconciled && (
                    <div className="mt-3 text-xs text-amber-800 bg-amber-100 rounded p-2">
                      A variance may be caused by: Journal Entries hitting AR, retainer deposits, write-offs, or invoices in a currency not yet synced. Check QBO AR Aging report and compare to Ledger Reports.
                    </div>
                  )}
                </div>

                {/* Sync stats */}
                <div className="bg-stone-50 ring-1 ring-stone-200 rounded-md p-3">
                  <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">This sync</div>
                  <div className="grid grid-cols-5 gap-2 text-center">
                    {[
                      { label: "Customers", value: syncResult.customers },
                      { label: "Contacts", value: syncResult.contacts },
                      { label: "New invoices", value: syncResult.invoicesCreated },
                      { label: "Updated", value: syncResult.invoicesUpdated },
                      { label: "Auto-closed", value: syncResult.invoicesClosed },
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

            {/* Sync history */}
            {syncHistory.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Sync history</div>
                <div className="space-y-1.5">
                  {syncHistory.slice(0, 5).map((log: any) => {
                    const reconciled = Math.abs(log.difference || 0) < 1;
                    return (
                      <div key={log.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-stone-100 last:border-0">
                        {log.status === "success"
                          ? <CheckCircle size={14} className={reconciled ? "text-emerald-500" : "text-amber-500"} />
                          : <XCircle size={14} className="text-rose-500" />}
                        <span className="text-stone-500 text-[12px] w-36">{new Date(log.syncedAt).toLocaleString("en-IE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        {log.status === "success" ? (
                          <>
                            <span className="text-stone-600 text-[12px]">{log.invoicesCreated} new · {log.invoicesUpdated} updated · {log.invoicesClosed} closed</span>
                            <span className={`ml-auto text-[12px] font-medium tabular-nums ${reconciled ? "text-emerald-700" : "text-amber-700"}`}>
                              {reconciled ? "✓ Reconciled" : `Δ ${fmt.money(log.difference || 0)}`}
                            </span>
                            <span className="text-stone-400 text-[11px]">{log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : ""}</span>
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
          <div className="space-y-3">
            <div className="text-sm text-stone-600">Connect QuickBooks Online to sync customers and outstanding invoices automatically.</div>
            <div className="bg-amber-50 ring-1 ring-amber-200 rounded-md p-3 text-sm text-amber-800">
              <div className="font-medium mb-1">Required Vercel env vars:</div>
              <div className="font-mono text-[12px] space-y-0.5">
                <div>QBO_CLIENT_ID</div><div>QBO_CLIENT_SECRET</div>
                <div>QBO_REDIRECT_URI = https://ledger-app-alpha-roan.vercel.app/api/qbo/callback</div>
              </div>
            </div>
            <Button icon={Link2} onClick={() => window.location.href = "/api/qbo"}>Connect QuickBooks Online</Button>
          </div>
        )}
      </Card>

      {/* Reps & Regions */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Users size={16} className="text-stone-600" />
          <h3 className="text-sm font-semibold text-stone-900">Reps &amp; Regions</h3>
        </div>

        {/* Classification level */}
        <div className="mb-5">
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">Classification level</div>
          <div className="flex gap-2">
            {(["customer", "project"] as const).map(level => (
              <button key={level} onClick={() => isAdmin && updateOrgSettings({ classificationLevel: level })}
                className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${orgSettings?.classificationLevel === level ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"}`}>
                By {level === "customer" ? "Customer" : "Project / Sub-customer"}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-stone-500 mt-2">
            {orgSettings?.classificationLevel === "customer"
              ? "Rep and Region are assigned at the Customer level. All invoices for a customer belong to the assigned rep."
              : "Rep and Region are assigned at the Project (sub-customer) level. Useful when one customer has multiple reps per project."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Reps */}
          <div>
            <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">Reps ({reps?.length ?? 0})</div>
            {(reps ?? []).length > 0 && (
              <div className="relative mb-2">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                <input
                  value={repSearch}
                  onChange={e => setRepSearch(e.target.value)}
                  placeholder="Search reps…"
                  className="w-full h-8 pl-7 pr-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
              </div>
            )}
            <div className="space-y-1 mb-3 max-h-48 overflow-y-auto">
              {(reps ?? []).length === 0 && <div className="text-sm text-stone-400 py-2">No reps defined yet.</div>}
              {(reps ?? [])
                .filter((r: any) => !repSearch || r.name?.toLowerCase().includes(repSearch.toLowerCase()) || r.email?.toLowerCase().includes(repSearch.toLowerCase()))
                .map((r: any) => {
                const loginInfo = repLogins[r.id];
                return (
                  <div key={r.id} className="px-3 py-2 rounded-md bg-stone-50 ring-1 ring-stone-100">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-stone-800">{r.name}</div>
                        {r.email && <div className="text-[11px] text-stone-500">{r.email}</div>}
                      </div>
                      <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => {
                                setRepLoginModal({ repId: r.id, repName: r.name, hasLogin: loginInfo?.hasLogin ?? false });
                                setRepLoginPassword(""); setRepLoginConfirm(""); setRepLoginError(""); setRepLoginSuccess(""); setShowRepPassword(false);
                              }}
                              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-stone-900 text-white hover:bg-stone-700 transition-colors"
                              title={loginInfo?.hasLogin ? "Reset password" : "Create login"}>
                              <KeyRound size={11} />
                              {loginInfo?.hasLogin ? "Reset" : "Create login"}
                            </button>
                            <button onClick={() => deleteRep(r.id)} className="p-1 text-stone-400 hover:text-rose-600 rounded">
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {loginInfo?.hasLogin && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                        <span className="text-[10px] text-stone-400">Login: {loginInfo.email}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {isAdmin && (
              <div className="space-y-1.5">
                <input value={newRepName} onChange={e => setNewRepName(e.target.value)} placeholder="Rep name *"
                  className="w-full h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
                <input value={newRepEmail} onChange={e => setNewRepEmail(e.target.value)} placeholder="Email (optional)"
                  className="w-full h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
                <Button size="sm" icon={Plus} disabled={addingRep || !newRepName.trim()} onClick={async () => {
                  setAddingRep(true);
                  try { await addRep({ name: newRepName.trim(), email: newRepEmail.trim() || undefined }); setNewRepName(""); setNewRepEmail(""); }
                  finally { setAddingRep(false); }
                }}>Add rep</Button>
              </div>
            )}
          </div>

          {/* Regions */}
          <div>
            <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">Regions ({regions?.length ?? 0})</div>
            <div className="space-y-1 mb-3 max-h-48 overflow-y-auto">
              {(regions ?? []).length === 0 && <div className="text-sm text-stone-400 py-2">No regions defined yet.</div>}
              {(regions ?? []).map((r: any) => (
                <div key={r.id} className="flex items-center justify-between px-3 py-2 rounded-md bg-stone-50 ring-1 ring-stone-100">
                  <div className="flex items-center gap-2">
                    <MapPin size={13} className="text-stone-400" />
                    <span className="text-sm font-medium text-stone-800">{r.name}</span>
                  </div>
                  {isAdmin && (
                    <button onClick={() => deleteRegion(r.id)} className="p-1 text-stone-400 hover:text-rose-600 rounded">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {isAdmin && (
              <div className="space-y-1.5">
                <input value={newRegionName} onChange={e => setNewRegionName(e.target.value)} placeholder="Region name *"
                  className="w-full h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
                <Button size="sm" icon={Plus} disabled={addingRegion || !newRegionName.trim()} onClick={async () => {
                  setAddingRegion(true);
                  try { await addRegion({ name: newRegionName.trim() }); setNewRegionName(""); }
                  finally { setAddingRegion(false); }
                }}>Add region</Button>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Per-org SMTP Settings */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Mail size={16} className="text-stone-600" />
          <h3 className="text-sm font-semibold text-stone-900">Email settings</h3>
          {smtpStatus?.configured
            ? <Badge variant="green" size="sm">Configured</Badge>
            : <Badge variant="neutral" size="sm">Not configured</Badge>}
        </div>

        {/* Configured state — show summary */}
        {smtpStatus?.configured && !showSmtpForm ? (
          <div className="space-y-3">
            <div className="bg-emerald-50 ring-1 ring-emerald-200 rounded-md p-3">
              <div className="flex items-center gap-2 mb-2">
                <Check size={14} className="text-emerald-600" />
                <span className="text-sm font-medium text-emerald-900">Email configured</span>
              </div>
              <div className="text-[11px] text-emerald-700 space-y-0.5 ml-5">
                <div>Server: {smtpStatus.settings?.host}:{smtpStatus.settings?.port}</div>
                <div>From: {smtpStatus.settings?.fromEmail}{smtpStatus.settings?.fromName ? ` (${smtpStatus.settings.fromName})` : ""}</div>
                <div>Username: {smtpStatus.settings?.user}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="secondary" size="sm" onClick={handleTestEmail} disabled={testingEmail}>
                {testingEmail ? "Sending…" : "Send test email"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => {
                setSmtpForm({
                  host: smtpStatus.settings?.host || "mail-eu.smtp2go.com",
                  port: String(smtpStatus.settings?.port || "2525"),
                  user: smtpStatus.settings?.user || "",
                  pass: "",
                  fromEmail: smtpStatus.settings?.fromEmail || "",
                  fromName: smtpStatus.settings?.fromName || "",
                });
                setShowSmtpForm(true);
              }}>Edit</Button>
              <Button variant="ghost" size="sm" onClick={handleSmtpDelete} className="text-rose-600 hover:text-rose-700">Remove</Button>
            </div>
            {testResult && (
              <div className={`text-xs px-3 py-2 rounded ${testResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                {testResult.message}
              </div>
            )}
          </div>

        ) : (
          /* Not configured or editing — show form */
          <div className="space-y-3">
            {!smtpStatus?.configured && (
              <div className="text-sm text-stone-600">
                Configure your organisation's SMTP settings to send reminder emails. Each organisation has its own email configuration.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">SMTP Host</label>
                <input
                  value={smtpForm.host}
                  onChange={e => setSmtpForm(p => ({ ...p, host: e.target.value }))}
                  placeholder="mail-eu.smtp2go.com"
                  className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Port</label>
                <input
                  value={smtpForm.port}
                  onChange={e => setSmtpForm(p => ({ ...p, port: e.target.value }))}
                  placeholder="2525"
                  className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">SMTP Username</label>
              <input
                value={smtpForm.user}
                onChange={e => setSmtpForm(p => ({ ...p, user: e.target.value }))}
                placeholder="your-smtp2go-username"
                className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                SMTP Password {smtpStatus?.configured && <span className="text-stone-400 normal-case font-normal">(leave blank to keep existing)</span>}
              </label>
              <input
                type="password"
                value={smtpForm.pass}
                onChange={e => setSmtpForm(p => ({ ...p, pass: e.target.value }))}
                placeholder={smtpStatus?.configured ? "••••••••" : "your-smtp2go-password"}
                className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">From Email *</label>
                <input
                  value={smtpForm.fromEmail}
                  onChange={e => setSmtpForm(p => ({ ...p, fromEmail: e.target.value }))}
                  placeholder="ar@yourcompany.ie"
                  className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">From Name (optional)</label>
                <input
                  value={smtpForm.fromName}
                  onChange={e => setSmtpForm(p => ({ ...p, fromName: e.target.value }))}
                  placeholder="Accounts Receivable"
                  className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
              </div>
            </div>

            <div className="bg-stone-50 ring-1 ring-stone-200 rounded-md p-3 text-[11px] text-stone-600 space-y-0.5">
              <div className="font-medium text-stone-700 mb-1">SMTP2Go quick reference:</div>
              <div>Host: <span className="font-mono">mail-eu.smtp2go.com</span> · Port: <span className="font-mono">2525</span></div>
              <div>Get your username and password from <span className="font-mono">smtp2go.com</span> → Settings → SMTP Users</div>
              <div>Make sure your From Email is verified in SMTP2Go → Sender Domains</div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={handleSmtpSave}
                disabled={savingSmtp || !smtpForm.host || !smtpForm.user || !smtpForm.fromEmail || (!smtpForm.pass && !smtpStatus?.configured)}>
                {savingSmtp ? "Saving…" : "Save email settings"}
              </Button>
              {smtpStatus?.configured && (
                <Button variant="ghost" size="sm" onClick={() => setShowSmtpForm(false)}>Cancel</Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Organisation Branding */}
      {isAdmin && (
        <Card className="mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Palette size={16} className="text-stone-600" />
            <h3 className="text-sm font-semibold text-stone-900">Organisation branding</h3>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Display name</label>
                <input
                  value={brandingForm.displayName}
                  onChange={e => setBrandingForm(p => ({ ...p, displayName: e.target.value }))}
                  placeholder={orgSettings?.name || "Company name shown in sidebar"}
                  className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
                <p className="text-[11px] text-stone-400 mt-1">Override the sidebar company name.</p>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Logo URL</label>
                <input
                  value={brandingForm.logoUrl}
                  onChange={e => setBrandingForm(p => ({ ...p, logoUrl: e.target.value }))}
                  placeholder="https://example.com/logo.png"
                  className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
                <p className="text-[11px] text-stone-400 mt-1">Paste a URL to your company logo (PNG/SVG).</p>
              </div>
            </div>
            {brandingForm.logoUrl && (
              <div className="flex items-center gap-3 p-3 bg-stone-50 rounded-md ring-1 ring-stone-100">
                <img src={brandingForm.logoUrl} alt="Logo preview" className="w-10 h-10 object-contain rounded" onError={e => (e.currentTarget.style.display = "none")} />
                <div>
                  <div className="text-sm font-semibold text-stone-900">{brandingForm.displayName || orgSettings?.name || "Company name"}</div>
                  <div className="text-[10px] text-stone-500 tracking-wide">COLLECTIONS CRM</div>
                </div>
                <span className="ml-auto text-[11px] text-stone-400">Sidebar preview</span>
              </div>
            )}
            <Button
              size="sm"
              disabled={savingBranding}
              onClick={async () => {
                setSavingBranding(true);
                try {
                  await updateOrgSettings({ logoUrl: brandingForm.logoUrl || null, displayName: brandingForm.displayName || null });
                } finally { setSavingBranding(false); }
              }}>
              {savingBranding ? "Saving…" : "Save branding"}
            </Button>
          </div>
        </Card>
      )}

      {/* Date format */}
      {isAdmin && (
        <Card className="mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Calendar size={16} className="text-stone-600" />
            <h3 className="text-sm font-semibold text-stone-900">Date format</h3>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: "DD MMM YYYY", label: "07 May 2026", desc: "DD MMM YYYY" },
                { value: "DD/MM/YYYY",  label: "07/05/2026",  desc: "DD/MM/YYYY" },
                { value: "MM/DD/YYYY",  label: "05/07/2026",  desc: "MM/DD/YYYY" },
                { value: "YYYY-MM-DD",  label: "2026-05-07",  desc: "YYYY-MM-DD" },
                { value: "MMM DD, YYYY", label: "May 07, 2026", desc: "MMM DD, YYYY" },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDateFormat(opt.value)}
                  className={`px-3 py-2 rounded-md text-left text-sm border transition-colors ${dateFormat === opt.value ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-700 border-stone-200 hover:border-stone-400"}`}>
                  <div className="font-medium font-mono">{opt.label}</div>
                  <div className={`text-[10px] ${dateFormat === opt.value ? "text-stone-300" : "text-stone-400"}`}>{opt.desc}</div>
                </button>
              ))}
            </div>
            <Button
              size="sm"
              disabled={savingDateFormat}
              onClick={async () => {
                setSavingDateFormat(true);
                try { await updateOrgSettings({ dateFormat }); }
                finally { setSavingDateFormat(false); }
              }}>
              {savingDateFormat ? "Saving…" : "Save date format"}
            </Button>
          </div>
        </Card>
      )}

      {/* Demo data */}
      {isAdmin && (
        <Card>
          <div className="flex items-center gap-2 mb-4"><Database size={16} className="text-stone-600" /><h3 className="text-sm font-semibold text-stone-900">Demo data</h3></div>
          <div className="text-sm text-stone-600 mb-3">Currently <strong>{customers.length}</strong> customers and <strong>{invoices.length}</strong> invoices.</div>
          <div className="bg-amber-50 ring-1 ring-amber-200 rounded-md p-2.5 text-xs text-amber-800 mb-3 flex items-start gap-2">
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" /> Only click once — calling twice creates duplicates.
          </div>
          <Button onClick={handleSeed} disabled={seeding}>{seeding ? "Loading…" : "Load demo data"}</Button>
        </Card>
      )}

      {/* Rep Login Modal */}
      {repLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-2 mb-1">
              <KeyRound size={16} className="text-stone-700" />
              <h2 className="text-base font-semibold text-stone-900">
                {repLoginModal.hasLogin ? "Reset password" : "Create rep login"}
              </h2>
            </div>
            <p className="text-[12px] text-stone-500 mb-5">
              {repLoginModal.hasLogin
                ? `Set a new password for ${repLoginModal.repName}.`
                : `Create a login for ${repLoginModal.repName}. They'll be able to log in and view their assigned receivables.`}
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">New password</label>
                <div className="relative">
                  <input
                    type={showRepPassword ? "text" : "password"}
                    value={repLoginPassword}
                    onChange={e => setRepLoginPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    className="w-full h-9 px-3 pr-9 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                  />
                  <button type="button" onClick={() => setShowRepPassword(p => !p)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700">
                    {showRepPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Confirm password</label>
                <input
                  type={showRepPassword ? "text" : "password"}
                  value={repLoginConfirm}
                  onChange={e => setRepLoginConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
              </div>

              {repLoginError && (
                <div className="text-xs text-rose-600 bg-rose-50 ring-1 ring-rose-200 rounded px-3 py-2">
                  {repLoginError}
                </div>
              )}
              {repLoginSuccess && (
                <div className="text-xs text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded px-3 py-2">
                  {repLoginSuccess}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mt-5">
              {!repLoginSuccess ? (
                <>
                  <Button
                    onClick={handleRepLoginSave}
                    disabled={repLoginSaving || !repLoginPassword || !repLoginConfirm}>
                    {repLoginSaving ? "Saving…" : repLoginModal.hasLogin ? "Reset password" : "Create login"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRepLoginModal(null)}>Cancel</Button>
                </>
              ) : (
                <Button onClick={() => setRepLoginModal(null)}>Done</Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
