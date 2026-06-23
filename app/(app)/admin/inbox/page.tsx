"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Mail, RefreshCw, Loader, X, Send, PenSquare, Plug, Paperclip,
  Inbox as InboxIcon, SendHorizontal, Settings as SettingsIcon, Reply, AlertTriangle,
} from "lucide-react";

type Account = {
  connected: boolean; needsSetup?: boolean;
  emailAddress?: string; fromName?: string | null;
  imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number;
  username?: string; status?: string; lastError?: string | null;
};
type Msg = { uid: number; subject: string; from: string; fromName: string; to: string; date: string | null; seen: boolean; hasAttachments: boolean };
type FullMsg = { uid: number; subject: string; from: { text: string; name: string }; to: string; cc: string; date: string | null; html: string | null; text: string; attachments: { filename: string; size: number; contentType: string }[] };

const FOLDERS = [{ key: "INBOX", label: "Inbox", icon: InboxIcon }, { key: "Sent", label: "Sent", icon: SendHorizontal }];

export default function AdminInboxPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loadingAcct, setLoadingAcct] = useState(true);
  const [mailbox, setMailbox] = useState("INBOX");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [msgErr, setMsgErr] = useState("");
  const [open, setOpen] = useState<FullMsg | null>(null);
  const [loadingOpen, setLoadingOpen] = useState(false);
  const [compose, setCompose] = useState<{ to: string; cc: string; subject: string; body: string } | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadAccount = useCallback(() => {
    setLoadingAcct(true);
    fetch("/api/admin/email/account").then(r => r.json()).then(setAccount).finally(() => setLoadingAcct(false));
  }, []);
  useEffect(() => { loadAccount(); }, [loadAccount]);

  const loadMessages = useCallback((box: string) => {
    setLoadingMsgs(true); setMsgErr(""); setOpen(null);
    fetch(`/api/admin/email/messages?mailbox=${encodeURIComponent(box)}&limit=50`)
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "Failed"); return d; })
      .then(d => setMessages(d.messages ?? []))
      .catch(e => { setMessages([]); setMsgErr(e.message); })
      .finally(() => setLoadingMsgs(false));
  }, []);
  useEffect(() => { if (account?.connected) loadMessages(mailbox); }, [account?.connected, mailbox, loadMessages]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); } }, [toast]);

  const openMessage = (uid: number) => {
    setLoadingOpen(true);
    fetch(`/api/admin/email/messages/${uid}?mailbox=${encodeURIComponent(mailbox)}`)
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then(d => { setOpen(d.message); setMessages(ms => ms.map(m => m.uid === uid ? { ...m, seen: true } : m)); })
      .catch(e => setToast({ ok: false, msg: e.message }))
      .finally(() => setLoadingOpen(false));
  };

  if (loadingAcct) return <div className="h-72 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse max-w-5xl mx-auto" />;

  // ── Not connected → connect screen ──
  if (!account?.connected || showConnect) {
    return <ConnectForm account={account} onCancel={account?.connected ? () => setShowConnect(false) : undefined}
      onConnected={() => { setShowConnect(false); loadAccount(); setToast({ ok: true, msg: "Mailbox connected" }); }} onToast={setToast} toast={toast} />;
  }

  return (
    <div className="max-w-[1500px] mx-auto h-[calc(100vh-100px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center"><Mail size={16} className="text-emerald-400" /></span>
          <div><h1 className="text-base font-semibold text-white leading-none">{account.emailAddress}</h1><p className="text-[11px] text-stone-500 mt-1">Connected mailbox</p></div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => loadMessages(mailbox)} className="flex items-center gap-1.5 h-9 px-3 text-xs rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800"><RefreshCw size={13} className={loadingMsgs ? "animate-spin" : ""} /> Refresh</button>
          <button onClick={() => setCompose({ to: "", cc: "", subject: "", body: "" })} className="flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"><PenSquare size={14} /> Compose</button>
          <button onClick={() => setShowConnect(true)} title="Mailbox settings" className="h-9 w-9 flex items-center justify-center rounded-lg border border-stone-700 text-stone-400 hover:bg-stone-800"><SettingsIcon size={14} /></button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex gap-3">
        {/* Folders */}
        <div className="w-40 shrink-0 space-y-0.5">
          {FOLDERS.map(f => (
            <button key={f.key} onClick={() => setMailbox(f.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors ${mailbox === f.key ? "bg-stone-800 text-white font-medium" : "text-stone-500 hover:bg-stone-900 hover:text-stone-300"}`}>
              <f.icon size={14} className={mailbox === f.key ? "text-emerald-400" : "text-stone-600"} /> {f.label}
            </button>
          ))}
        </div>

        {/* Message list */}
        <div className="w-[340px] shrink-0 rounded-xl border border-stone-800 overflow-hidden flex flex-col">
          {loadingMsgs ? (
            <div className="p-3 space-y-2">{[1,2,3,4,5,6].map(i => <div key={i} className="h-12 bg-stone-800 rounded animate-pulse" />)}</div>
          ) : msgErr ? (
            <div className="p-6 text-center text-[13px] text-rose-400 flex flex-col items-center gap-2"><AlertTriangle size={18} /> {msgErr}</div>
          ) : messages.length === 0 ? (
            <div className="p-6 text-center text-[13px] text-stone-500">No messages.</div>
          ) : (
            <div className="overflow-y-auto divide-y divide-stone-800/60">
              {messages.map(m => (
                <button key={m.uid} onClick={() => openMessage(m.uid)}
                  className={`w-full text-left px-3 py-2.5 hover:bg-stone-800/40 ${open?.uid === m.uid ? "bg-stone-800/60" : ""} ${!m.seen ? "border-l-2 border-emerald-500" : "border-l-2 border-transparent"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[12.5px] truncate ${m.seen ? "text-stone-400" : "text-white font-medium"}`}>{mailbox === "Sent" ? m.to : (m.fromName || m.from)}</span>
                    <span className="text-[10px] text-stone-600 shrink-0">{m.date ? new Date(m.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}</span>
                  </div>
                  <p className={`text-[12px] truncate mt-0.5 ${m.seen ? "text-stone-500" : "text-stone-300"}`}>{m.subject}{m.hasAttachments ? " 📎" : ""}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Reader */}
        <div className="flex-1 min-w-0 rounded-xl border border-stone-800 overflow-hidden flex flex-col">
          {loadingOpen ? (
            <div className="flex-1 flex items-center justify-center"><Loader size={20} className="animate-spin text-stone-600" /></div>
          ) : !open ? (
            <div className="flex-1 flex flex-col items-center justify-center text-stone-600 gap-2"><Mail size={28} /><p className="text-sm">Select a message</p></div>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-stone-800">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-sm font-semibold text-white">{open.subject}</h2>
                  <button onClick={() => setCompose({ to: open.from.text || open.from.name, cc: "", subject: open.subject.startsWith("Re:") ? open.subject : `Re: ${open.subject}`, body: `\n\n———\nOn ${open.date ? new Date(open.date).toLocaleString() : ""}, ${open.from.name} wrote:` })}
                    className="shrink-0 flex items-center gap-1.5 h-7 px-2.5 text-[11px] rounded-md border border-stone-700 text-stone-300 hover:bg-stone-800"><Reply size={12} /> Reply</button>
                </div>
                <p className="text-[12px] text-stone-400 mt-1.5"><span className="text-stone-500">From</span> {open.from.name} &lt;{open.from.text}&gt;</p>
                <p className="text-[12px] text-stone-400"><span className="text-stone-500">To</span> {open.to}{open.cc ? ` · Cc ${open.cc}` : ""}</p>
                {open.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">{open.attachments.map((a, i) => <span key={i} className="text-[11px] text-stone-400 bg-stone-800 rounded px-2 py-0.5 flex items-center gap-1"><Paperclip size={10} /> {a.filename}</span>)}</div>
                )}
              </div>
              <div className="flex-1 overflow-hidden bg-white">
                {open.html
                  ? <iframe title="email" sandbox="" srcDoc={open.html} className="w-full h-full border-0" />
                  : <pre className="p-5 text-[13px] text-stone-800 whitespace-pre-wrap font-sans h-full overflow-y-auto">{open.text}</pre>}
              </div>
            </>
          )}
        </div>
      </div>

      {compose && <Compose initial={compose} onClose={() => setCompose(null)} onSent={() => { setCompose(null); setToast({ ok: true, msg: "Sent" }); }} onToast={setToast} />}
      {toast && <div className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-xl ${toast.ok ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{toast.msg}</div>}
    </div>
  );
}

// ── Connect / settings form ──────────────────────────────────────────────────
function ConnectForm({ account, onConnected, onCancel, onToast, toast }: {
  account: Account | null; onConnected: () => void; onCancel?: () => void;
  onToast: (t: { ok: boolean; msg: string }) => void; toast: { ok: boolean; msg: string } | null;
}) {
  const [f, setF] = useState({
    emailAddress: account?.emailAddress ?? "", fromName: account?.fromName ?? "", password: "",
    imapHost: account?.imapHost ?? "mail.primeaccountax.com", imapPort: account?.imapPort ?? 993,
    smtpHost: account?.smtpHost ?? "mail.primeaccountax.com", smtpPort: account?.smtpPort ?? 465,
    username: account?.username ?? "",
  });
  const [saving, setSaving] = useState(false);
  const inp = "w-full px-3 py-2 text-[13px] rounded-md bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";
  const lbl = "text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1";
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));

  const connect = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/admin/email/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, username: f.username || f.emailAddress }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) onConnected(); else onToast({ ok: false, msg: d.error ?? "Connection failed" });
    } catch { onToast({ ok: false, msg: "Connection failed" }); }
    finally { setSaving(false); }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect this mailbox? You can reconnect any time.")) return;
    await fetch("/api/admin/email/account", { method: "DELETE" });
    onToast({ ok: true, msg: "Disconnected" }); onConnected();
  };

  return (
    <div className="max-w-lg mx-auto py-8">
      <div className="flex items-center gap-2.5 mb-1"><span className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center"><Plug size={16} className="text-emerald-400" /></span>
        <h1 className="text-lg font-bold text-white">Connect your mailbox</h1></div>
      <p className="text-[13px] text-stone-500 mb-5">Send and receive email inside the portal from your own <span className="text-stone-300">@primeaccountax.com</span> address — no Outlook needed.</p>

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
          <div className="flex gap-2">
            {onCancel && <button onClick={onCancel} className="h-9 px-4 text-xs font-medium rounded-lg text-stone-400 hover:bg-stone-800">Cancel</button>}
            <button onClick={connect} disabled={saving} className="h-9 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 text-white flex items-center gap-1.5">{saving && <Loader size={13} className="animate-spin" />} {saving ? "Verifying…" : "Connect"}</button>
          </div>
        </div>
      </div>
      {toast && <div className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-xl ${toast.ok ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{toast.msg}</div>}
    </div>
  );
}

// ── Compose ──────────────────────────────────────────────────────────────────
function Compose({ initial, onClose, onSent, onToast }: {
  initial: { to: string; cc: string; subject: string; body: string };
  onClose: () => void; onSent: () => void; onToast: (t: { ok: boolean; msg: string }) => void;
}) {
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [sending, setSending] = useState(false);
  const inp = "w-full px-3 py-2 text-[13px] rounded-md bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";

  const send = async () => {
    if (!to.trim()) { onToast({ ok: false, msg: "Recipient required" }); return; }
    setSending(true);
    try {
      const html = body.replace(/\n/g, "<br>");
      const r = await fetch("/api/admin/email/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to, cc, subject, text: body, html }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) onSent(); else onToast({ ok: false, msg: d.error ?? "Send failed" });
    } catch { onToast({ ok: false, msg: "Send failed" }); }
    finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-stone-900 rounded-xl w-full max-w-2xl ring-1 ring-stone-800 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-800"><h2 className="text-sm font-semibold text-white">New message</h2><button onClick={onClose} className="text-stone-500 hover:text-stone-300"><X size={18} /></button></div>
        <div className="p-4 space-y-2.5">
          <input className={inp} value={to} onChange={e => setTo(e.target.value)} placeholder="To" />
          <input className={inp} value={cc} onChange={e => setCc(e.target.value)} placeholder="Cc (optional)" />
          <input className={inp} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" />
          <textarea className={`${inp} resize-none`} rows={11} value={body} onChange={e => setBody(e.target.value)} placeholder="Write your message…" />
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-stone-800">
          <button onClick={onClose} className="h-9 px-4 text-xs font-medium rounded-lg text-stone-400 hover:bg-stone-800">Discard</button>
          <button onClick={send} disabled={sending} className="h-9 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 text-white flex items-center gap-1.5">{sending ? <Loader size={13} className="animate-spin" /> : <Send size={13} />} Send</button>
        </div>
      </div>
    </div>
  );
}
