"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useData } from "@/components/data-provider";
import { Card, Button, Badge } from "@/components/ui";
import {
  ChevronLeft, Mail, Server, Unlink, Check, Loader,
  ChevronDown, ChevronUp,
} from "lucide-react";

export default function EmailSettingsPage() {
  const { toast } = useData() as any;
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const userEmail = session?.user?.email || "";

  // Gmail
  const [gmailStatus, setGmailStatus] = useState<any>(null);
  const [gmailDisconnecting, setGmailDisconnecting] = useState(false);

  // Microsoft
  const [msStatus, setMsStatus] = useState<any>(null);
  const [msDisconnecting, setMsDisconnecting] = useState(false);

  // SMTP
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

  useEffect(() => {
    fetch("/api/gmail?status=1").then(r => r.json()).then(setGmailStatus).catch(() => setGmailStatus({ connected: false }));
    fetch("/api/microsoft?status=1").then(r => r.json()).then(setMsStatus).catch(() => setMsStatus({ connected: false }));
    loadSmtp();
  }, []);

  useEffect(() => {
    const gmail     = searchParams.get("gmail");
    const microsoft = searchParams.get("microsoft");
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
    setShowSmtpForm(false);
    toast("SMTP settings removed");
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
          subject: "Ledger — Email Test",
          body: "This is a test email. Your email transport is configured correctly.",
        }),
      });
      const data = await res.json();
      if (res.ok) setTestResult({ ok: true, message: `Sent to ${userEmail} via ${data.transport || "smtp"}` });
      else setTestResult({ ok: false, message: data.error || "Send failed" });
    } catch {
      setTestResult({ ok: false, message: "Request failed" });
    } finally {
      setTestingEmail(false);
    }
  };

  const oauthActive = gmailStatus?.connected || msStatus?.connected;
  const loading     = gmailStatus === null || msStatus === null || smtpStatus === null;

  // Active transport label for header badge
  const activeLabel = gmailStatus?.connected
    ? "Gmail active"
    : msStatus?.connected
    ? "Microsoft active"
    : smtpStatus?.configured
    ? "SMTP active"
    : null;

  return (
    <div className="p-6 max-w-[720px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-200 mb-3 transition-colors"
        >
          <ChevronLeft size={14} /> Settings
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-white tracking-tight">Email</h1>
          {activeLabel && (
            <span className="text-[12px] font-medium px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
              {activeLabel}
            </span>
          )}
        </div>
        <p className="text-sm text-stone-400 mt-1">
          Choose one transport for outbound email — Gmail, Microsoft, or SMTP.
        </p>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-stone-500 py-4">
            <Loader size={14} className="animate-spin" /> Checking…
          </div>
        ) : (
          <div className="space-y-3">

            {/* ── Gmail ── */}
            <div className={`rounded-lg ring-1 p-4 transition-colors ${
              gmailStatus.connected ? "ring-emerald-500/30 bg-emerald-500/10" : "ring-stone-700 bg-stone-800/40"
            }`}>
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  gmailStatus.connected ? "bg-emerald-500/15" : "bg-stone-800"
                }`}>
                  <Mail size={16} className={gmailStatus.connected ? "text-emerald-400" : "text-stone-400"} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">Gmail</span>
                    {gmailStatus.connected && <Badge variant="green" size="sm">Active</Badge>}
                  </div>
                  <p className="text-[12px] text-stone-500 mt-0.5 truncate">
                    {gmailStatus.connected
                      ? <><span className="font-mono text-stone-300">{gmailStatus.email}</span> · Sent mail appears in Gmail</>
                      : "Send via your Google account using OAuth — no SMTP credentials needed"}
                  </p>
                </div>
                <div className="shrink-0 ml-2">
                  {gmailStatus.connected ? (
                    <Button variant="ghost" size="sm" onClick={handleGmailDisconnect} disabled={gmailDisconnecting}>
                      <Unlink size={13} className="mr-1" />
                      {gmailDisconnecting ? "Disconnecting…" : "Disconnect"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={!!oauthActive}
                      onClick={() => (window.location.href = "/api/gmail")}
                      title={oauthActive ? "Disconnect the active transport first" : ""}
                    >
                      Connect Gmail
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* ── Microsoft ── */}
            <div className={`rounded-lg ring-1 p-4 transition-colors ${
              msStatus.connected ? "ring-emerald-500/30 bg-emerald-500/10" : "ring-stone-700 bg-stone-800/40"
            }`}>
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  msStatus.connected ? "bg-emerald-500/15" : "bg-stone-800"
                }`}>
                  <Mail size={16} className={msStatus.connected ? "text-emerald-400" : "text-stone-400"} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">Microsoft / Outlook</span>
                    {msStatus.connected && <Badge variant="green" size="sm">Active</Badge>}
                  </div>
                  <p className="text-[12px] text-stone-500 mt-0.5 truncate">
                    {msStatus.connected
                      ? <><span className="font-mono text-stone-300">{msStatus.email}</span> · Sent mail appears in Outlook</>
                      : "Send via Office 365 or personal Microsoft account using OAuth"}
                  </p>
                </div>
                <div className="shrink-0 ml-2">
                  {msStatus.connected ? (
                    <Button variant="ghost" size="sm" onClick={handleMsDisconnect} disabled={msDisconnecting}>
                      <Unlink size={13} className="mr-1" />
                      {msDisconnecting ? "Disconnecting…" : "Disconnect"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={!!oauthActive}
                      onClick={() => (window.location.href = "/api/microsoft")}
                      title={oauthActive ? "Disconnect the active transport first" : ""}
                    >
                      Connect Microsoft
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* ── SMTP ── */}
            <div className={`rounded-lg ring-1 transition-colors ${
              !oauthActive && smtpStatus.configured ? "ring-stone-600 bg-stone-800/50" : "ring-stone-700 bg-stone-800/30"
            }`}>
              <div className="flex items-center gap-3 p-4">
                <div className="w-9 h-9 rounded-lg bg-stone-800 flex items-center justify-center shrink-0">
                  <Server size={16} className="text-stone-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">SMTP</span>
                    {smtpStatus.configured && oauthActive  && <Badge variant="neutral" size="sm">Fallback</Badge>}
                    {smtpStatus.configured && !oauthActive && <Badge variant="neutral" size="sm">Active</Badge>}
                  </div>
                  <p className="text-[12px] text-stone-500 mt-0.5">
                    {smtpStatus.configured
                      ? <>{oauthActive ? "Configured as fallback · " : "Sending from "}<span className="font-mono text-stone-300">{smtpStatus.settings?.fromEmail}</span></>
                      : "Use your own SMTP server (e.g. SMTP2Go, SendGrid)"}
                  </p>
                </div>
                <button
                  onClick={() => setShowSmtpForm(v => !v)}
                  className="shrink-0 flex items-center gap-1 text-[12px] font-medium text-stone-400 hover:text-stone-200 transition-colors ml-2"
                >
                  {smtpStatus.configured ? "Edit" : "Configure"}
                  {showSmtpForm ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              </div>

              {/* Inline SMTP form */}
              {showSmtpForm && (
                <div className="border-t border-stone-800 px-4 pb-5 pt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">SMTP Host</label>
                      <input
                        value={smtpForm.host}
                        onChange={e => setSmtpForm(p => ({ ...p, host: e.target.value }))}
                        placeholder="mail-eu.smtp2go.com"
                        autoComplete="off"
                        className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Port</label>
                      <input
                        value={smtpForm.port}
                        onChange={e => setSmtpForm(p => ({ ...p, port: e.target.value }))}
                        placeholder="2525"
                        autoComplete="off"
                        className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">SMTP Username</label>
                    <input
                      value={smtpForm.user}
                      onChange={e => setSmtpForm(p => ({ ...p, user: e.target.value }))}
                      placeholder="your-smtp-username"
                      autoComplete="off"
                      className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    />
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
                      className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">From Email *</label>
                      <input
                        value={smtpForm.fromEmail}
                        onChange={e => setSmtpForm(p => ({ ...p, fromEmail: e.target.value }))}
                        placeholder="ar@yourcompany.com"
                        autoComplete="off"
                        className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">From Name</label>
                      <input
                        value={smtpForm.fromName}
                        onChange={e => setSmtpForm(p => ({ ...p, fromName: e.target.value }))}
                        placeholder="Accounts Receivable"
                        autoComplete="off"
                        className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  {/* Default CC */}
                  <div className="flex items-center justify-between pt-1">
                    <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Default CC on every email</label>
                    <button
                      type="button"
                      onClick={() => setSmtpForm(p => ({ ...p, ccEnabled: !p.ccEnabled }))}
                      className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${smtpForm.ccEnabled ? "bg-emerald-600" : "bg-stone-700"}`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${smtpForm.ccEnabled ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                  </div>
                  {smtpForm.ccEnabled && (
                    <input
                      type="email"
                      value={smtpForm.ccEmail}
                      onChange={e => setSmtpForm(p => ({ ...p, ccEmail: e.target.value }))}
                      placeholder="e.g. accounts@yourcompany.com"
                      className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    />
                  )}
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    <Button
                      onClick={handleSmtpSave}
                      disabled={savingSmtp || !smtpForm.host || !smtpForm.user || !smtpForm.fromEmail || (!smtpForm.pass && !smtpStatus.configured)}
                    >
                      {savingSmtp ? "Saving…" : "Save SMTP settings"}
                    </Button>
                    {smtpStatus.configured && (
                      <Button variant="secondary" size="sm" onClick={handleTestEmail} disabled={testingEmail}>
                        {testingEmail ? "Sending…" : "Send test email"}
                      </Button>
                    )}
                    {smtpStatus.configured && (
                      <Button variant="ghost" size="sm" onClick={handleSmtpDelete} className="text-rose-600 hover:text-rose-700">
                        Remove
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setShowSmtpForm(false)}>Cancel</Button>
                  </div>
                  {testResult && (
                    <div className={`text-xs px-3 py-2 rounded-md ring-1 ${testResult.ok ? "bg-emerald-500/10 ring-emerald-500/30 text-emerald-400" : "bg-rose-500/10 ring-rose-500/30 text-rose-400"}`}>
                      {testResult.ok ? <Check size={12} className="inline mr-1" /> : null}
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
        )}
      </Card>
    </div>
  );
}
