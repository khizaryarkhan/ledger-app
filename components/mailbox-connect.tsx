"use client";

import { useEffect, useState, useCallback } from "react";
import { Plug, Loader, CheckCircle2 } from "lucide-react";

type Account = {
  connected: boolean; needsSetup?: boolean;
  emailAddress?: string; fromName?: string | null;
  imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number;
  username?: string; status?: string; lastError?: string | null;
};

/**
 * Self-contained mailbox connect/disconnect panel. Used on
 * Settings → Email Integration. Each platform/super admin connects their own
 * @primeaccountax.com mailbox; the password is verified then encrypted at rest.
 */
export function MailboxConnect() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({
    emailAddress: "", fromName: "", password: "",
    imapHost: "mail.primeaccountax.com", imapPort: 993,
    smtpHost: "mail.primeaccountax.com", smtpPort: 465, username: "",
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/email/account").then(r => r.json()).then((a: Account) => {
      setAccount(a);
      if (a.connected) setF(p => ({
        ...p, emailAddress: a.emailAddress ?? "", fromName: a.fromName ?? "",
        imapHost: a.imapHost ?? p.imapHost, imapPort: a.imapPort ?? p.imapPort,
        smtpHost: a.smtpHost ?? p.smtpHost, smtpPort: a.smtpPort ?? p.smtpPort,
        username: a.username ?? "",
      }));
    }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); } }, [toast]);

  const inp = "w-full px-3 py-2 text-[13px] rounded-md bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";
  const lbl = "text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1";
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));

  const connect = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/admin/email/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, username: f.username || f.emailAddress }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setToast({ ok: true, msg: "Mailbox connected" }); setF(p => ({ ...p, password: "" })); load(); }
      else setToast({ ok: false, msg: d.error ?? "Connection failed" });
    } catch { setToast({ ok: false, msg: "Connection failed" }); }
    finally { setSaving(false); }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect this mailbox? You can reconnect any time.")) return;
    await fetch("/api/admin/email/account", { method: "DELETE" });
    setToast({ ok: true, msg: "Disconnected" }); load();
  };

  if (loading) return <div className="h-72 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" />;

  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center"><Plug size={16} className="text-emerald-400" /></span>
        <h1 className="text-lg font-bold text-white">Email Integration</h1>
      </div>
      <p className="text-[13px] text-stone-500 mb-5">Connect your own <span className="text-stone-300">@primeaccountax.com</span> mailbox to send and receive in the portal. Real sales communication goes from your address — not the system <span className="font-mono">support@</span> account.</p>

      {account?.connected && (
        <div className="mb-4 rounded-lg ring-1 ring-emerald-500/30 bg-emerald-500/5 px-4 py-2.5 flex items-center gap-2 text-[13px] text-emerald-300">
          <CheckCircle2 size={15} /> Connected as <span className="font-medium">{account.emailAddress}</span>
        </div>
      )}
      {account?.needsSetup && <div className="mb-4 rounded-lg ring-1 ring-amber-500/30 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-300">The <span className="font-mono">admin_email_accounts</span> table isn't set up yet — your developer needs to create it in Neon first.</div>}

      <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Email address</label><input className={inp} value={f.emailAddress} onChange={e => set("emailAddress", e.target.value)} placeholder="you@primeaccountax.com" /></div>
          <div><label className={lbl}>Display name</label><input className={inp} value={f.fromName} onChange={e => set("fromName", e.target.value)} placeholder="Your Name" /></div>
        </div>
        <div><label className={lbl}>Password</label><input className={inp} type="password" value={f.password} onChange={e => set("password", e.target.value)} placeholder={account?.connected ? "•••••••• (re-enter to update)" : "mailbox password"} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>IMAP host (incoming)</label><input className={inp} value={f.imapHost} onChange={e => set("imapHost", e.target.value)} /></div>
          <div><label className={lbl}>IMAP port</label><input className={inp} type="number" value={f.imapPort} onChange={e => set("imapPort", parseInt(e.target.value))} /></div>
          <div><label className={lbl}>SMTP host (outgoing)</label><input className={inp} value={f.smtpHost} onChange={e => set("smtpHost", e.target.value)} /></div>
          <div><label className={lbl}>SMTP port</label><input className={inp} type="number" value={f.smtpPort} onChange={e => set("smtpPort", parseInt(e.target.value))} /></div>
        </div>
        <p className="text-[11px] text-stone-600">We verify the connection before saving. Your password is encrypted at rest.</p>
        <div className="flex justify-between items-center pt-1">
          {account?.connected ? <button onClick={disconnect} className="text-[12px] text-stone-500 hover:text-rose-400">Disconnect mailbox</button> : <span />}
          <button onClick={connect} disabled={saving} className="h-9 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 text-white flex items-center gap-1.5">{saving && <Loader size={13} className="animate-spin" />} {saving ? "Verifying…" : account?.connected ? "Update" : "Connect"}</button>
        </div>
      </div>
      {toast && <div className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-xl ${toast.ok ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{toast.msg}</div>}
    </div>
  );
}
