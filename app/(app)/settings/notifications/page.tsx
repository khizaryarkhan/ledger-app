"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useData } from "@/components/data-provider";
import { Card, Button, Badge } from "@/components/ui";
import { ChevronLeft, Mail, Check, Loader } from "lucide-react";

export default function NotificationsSettingsPage() {
  const { data: session } = useSession();
  const { toast } = useData();

  const userEmail = session?.user?.email || "";

  const [smtpStatus, setSmtpStatus] = useState<any>(null);
  const [showSmtpForm, setShowSmtpForm] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [smtpForm, setSmtpForm] = useState({
    host: "mail-eu.smtp2go.com",
    port: "2525",
    user: "",
    pass: "",
    fromEmail: "",
    fromName: "",
  });

  useEffect(() => {
    fetch("/api/org/smtp")
      .then(r => r.json())
      .then(setSmtpStatus)
      .catch(() => setSmtpStatus({ configured: false }));
  }, []);

  const handleSmtpSave = async () => {
    setSavingSmtp(true);
    try {
      const payload: any = { ...smtpForm, port: parseInt(smtpForm.port) };
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
      toast("Email settings saved");
      setShowSmtpForm(false);
      const r = await fetch("/api/org/smtp");
      if (r.ok) setSmtpStatus(await r.json());
    } finally {
      setSavingSmtp(false);
    }
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
    } catch {
      setTestResult({ ok: false, message: "Request failed" });
    } finally {
      setTestingEmail(false);
    }
  };

  return (
    <div className="p-6 max-w-[720px] mx-auto">
      {/* Back + header */}
      <div className="mb-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-900 mb-3 transition-colors"
        >
          <ChevronLeft size={14} /> Settings
        </Link>
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Notifications & Email</h1>
        <p className="text-sm text-stone-500 mt-1">Configure your SMTP server for sending collection emails.</p>
      </div>

      {/* SMTP */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Mail size={16} className="text-stone-600" />
          <h3 className="text-sm font-semibold text-stone-900">Email settings</h3>
          {smtpStatus === null ? (
            <Loader size={13} className="animate-spin text-stone-400" />
          ) : smtpStatus.configured ? (
            <Badge variant="green" size="sm">Configured</Badge>
          ) : (
            <Badge variant="neutral" size="sm">Not configured</Badge>
          )}
        </div>

        {smtpStatus?.configured && !showSmtpForm ? (
          /* Configured summary */
          <div className="space-y-3">
            <div className="bg-emerald-50 ring-1 ring-emerald-200 rounded-md p-3">
              <div className="flex items-center gap-2 mb-2">
                <Check size={14} className="text-emerald-600" />
                <span className="text-sm font-medium text-emerald-900">Email configured</span>
              </div>
              <div className="text-[11px] text-emerald-700 space-y-0.5 ml-5">
                <div>Server: {smtpStatus.settings?.host}:{smtpStatus.settings?.port}</div>
                <div>
                  From: {smtpStatus.settings?.fromEmail}
                  {smtpStatus.settings?.fromName ? ` (${smtpStatus.settings.fromName})` : ""}
                </div>
                <div>Username: {smtpStatus.settings?.user}</div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="secondary" size="sm" onClick={handleTestEmail} disabled={testingEmail}>
                {testingEmail ? "Sending…" : "Send test email"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSmtpForm({
                    host: smtpStatus.settings?.host || "mail-eu.smtp2go.com",
                    port: String(smtpStatus.settings?.port || "2525"),
                    user: smtpStatus.settings?.user || "",
                    pass: "",
                    fromEmail: smtpStatus.settings?.fromEmail || "",
                    fromName: smtpStatus.settings?.fromName || "",
                  });
                  setShowSmtpForm(true);
                }}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSmtpDelete}
                className="text-rose-600 hover:text-rose-700"
              >
                Remove
              </Button>
            </div>

            {testResult && (
              <div
                className={`text-xs px-3 py-2 rounded ${
                  testResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                }`}
              >
                {testResult.message}
              </div>
            )}
          </div>
        ) : (
          /* Form — not configured or editing */
          <div className="space-y-3">
            {!smtpStatus?.configured && (
              <div className="text-sm text-stone-600">
                Configure your organisation's SMTP settings to send reminder emails. Each organisation has
                its own email configuration.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                  SMTP Host
                </label>
                <input
                  value={smtpForm.host}
                  onChange={e => setSmtpForm(p => ({ ...p, host: e.target.value }))}
                  placeholder="mail-eu.smtp2go.com"
                  className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                  Port
                </label>
                <input
                  value={smtpForm.port}
                  onChange={e => setSmtpForm(p => ({ ...p, port: e.target.value }))}
                  placeholder="2525"
                  className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                SMTP Username
              </label>
              <input
                value={smtpForm.user}
                onChange={e => setSmtpForm(p => ({ ...p, user: e.target.value }))}
                placeholder="your-smtp2go-username"
                className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                SMTP Password{" "}
                {smtpStatus?.configured && (
                  <span className="text-stone-400 normal-case font-normal">
                    (leave blank to keep existing)
                  </span>
                )}
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
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                  From Email *
                </label>
                <input
                  value={smtpForm.fromEmail}
                  onChange={e => setSmtpForm(p => ({ ...p, fromEmail: e.target.value }))}
                  placeholder="ar@yourcompany.ie"
                  className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                  From Name (optional)
                </label>
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
              <div>
                Host: <span className="font-mono">mail-eu.smtp2go.com</span> · Port:{" "}
                <span className="font-mono">2525</span>
              </div>
              <div>
                Get your username and password from{" "}
                <span className="font-mono">smtp2go.com</span> → Settings → SMTP Users
              </div>
              <div>Make sure your From Email is verified in SMTP2Go → Sender Domains</div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={handleSmtpSave}
                disabled={
                  savingSmtp ||
                  !smtpForm.host ||
                  !smtpForm.user ||
                  !smtpForm.fromEmail ||
                  (!smtpForm.pass && !smtpStatus?.configured)
                }
              >
                {savingSmtp ? "Saving…" : "Save email settings"}
              </Button>
              {smtpStatus?.configured && (
                <Button variant="ghost" size="sm" onClick={() => setShowSmtpForm(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
