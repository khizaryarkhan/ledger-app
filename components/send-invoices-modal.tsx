"use client";

import { useState } from "react";
import { Send, X, AlertTriangle } from "lucide-react";
import { genEmailRef } from "@/lib/email-ref";
import { renderInvoiceEmail } from "@/lib/ar-email";

// Minimal row shape the send modal needs. BoardRow is a structural superset,
// so the Collections Board can pass its rows directly.
export type SendRow = {
  inv: any;
  custId: string;
  custName: string;
  projName: string | null;
  bal: number;
  days: number;
  email: string | null;
};

const splitEmails = (s: string | null) =>
  (s || "").split(/[,;]/).map(e => e.trim().toLowerCase()).filter(e => e.includes("@"));
const uniqEmails = (vals: (string | null)[]) => {
  const set = new Set<string>();
  vals.forEach(v => splitEmails(v).forEach(e => set.add(e)));
  return [...set];
};
const domainOf = (email: string) => (email.split("@")[1] || "").trim().toLowerCase();
const NO_EMAIL = "(no email on file)";
/** The domain that owns an invoice — taken from its first billing email. */
const rowDomain = (r: SendRow) => {
  const first = splitEmails(r.email)[0];
  return first ? domainOf(first) : NO_EMAIL;
};

type DomainGroup = { domain: string; emails: string[]; rows: SendRow[]; total: number };

/**
 * Shared "send invoices" composer — used by the Collections Board (bulk) AND
 * the invoice detail page (single).
 *
 * Domain-aware: invoices are grouped by the DOMAIN of their billing email. A
 * project novated to another entity has invoices on a different domain — those
 * must never be emailed to the other party. When a selection spans more than
 * one domain the composer splits into one email per domain (each carrying only
 * that domain's invoices) and warns loudly before sending.
 */
export function SendInvoicesModal({ rows, ccy, multiCustomer = false, onClose, onSent, toast }: {
  rows: SendRow[];
  ccy: string;
  multiCustomer?: boolean;
  onClose: () => void;
  onSent: () => void;
  toast?: (m: string, t?: string) => void;
}) {
  // ── Group the selected invoices by billing-email domain ────────────────────
  const groups: DomainGroup[] = (() => {
    const m = new Map<string, DomainGroup>();
    for (const r of rows) {
      const d = rowDomain(r);
      if (!m.has(d)) m.set(d, { domain: d, emails: [], rows: [], total: 0 });
      const g = m.get(d)!;
      g.rows.push(r);
      g.total += r.bal;
    }
    for (const g of m.values()) g.emails = uniqEmails(g.rows.map(r => r.email));
    // Sendable groups first (largest balance), the no-email group last.
    return [...m.values()].sort((a, b) =>
      (a.domain === NO_EMAIL ? 1 : 0) - (b.domain === NO_EMAIL ? 1 : 0) || b.total - a.total);
  })();

  const sendable = groups.filter(g => g.domain !== NO_EMAIL);
  const noEmailGroup = groups.find(g => g.domain === NO_EMAIL) ?? null;
  const multiDomain = sendable.length > 1;

  const [emailRef] = useState(genEmailRef);
  // Per-domain editable "To" — prefilled with that domain's contacts.
  const [tos, setTos] = useState<Record<string, string>>(
    Object.fromEntries(sendable.map(g => [g.domain, g.emails.join(", ")])),
  );
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(`Open Invoices — Ref ${emailRef}`);
  const [body, setBody] = useState(
    `Hi,\n\nPlease find attached a statement of your open invoices along with copies of each invoice for your reference.\nCould you please share the expected payment dates at your earliest convenience?\nFeel free to reach out if you have any questions.`
  );
  const [attachPdf, setAttachPdf] = useState(true);
  const [includePortal, setIncludePortal] = useState(true);
  const [ack, setAck] = useState(false); // must confirm before a multi-domain send
  const [sending, setSending] = useState(false);

  // Send one domain group as a single email (scoped to its invoices).
  async function sendGroup(g: DomainGroup, toStr: string): Promise<{ ok: boolean; error?: string }> {
    const ids = g.rows.map(r => r.inv.id);
    const total = g.total;
    const emailCurrency = g.rows[0]?.inv?.currency || ccy;
    // Portal link — only when all invoices in the group belong to one customer.
    let portalUrl: string | null = null;
    const custIds = new Set(g.rows.map(r => r.custId));
    if (includePortal && custIds.size === 1) {
      try {
        const tk = await fetch("/api/portal/token", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId: g.rows[0].custId, invoiceIds: ids }),
        });
        if (tk.ok) portalUrl = (await tk.json()).url ?? null;
      } catch {}
    }
    const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const html = renderInvoiceEmail({
      subject, dateStr, total, currency: emailCurrency, portalUrl, intro: body,
      rows: g.rows.map(r => ({
        invoiceNumber: r.inv.invoiceNumber, customerName: r.custName, projectName: r.projName,
        invoiceDate: r.inv.invoiceDate, dueDate: r.inv.dueDate, balance: r.bal, currency: r.inv.currency, daysOverdue: r.days,
      })),
    });
    try {
      const res = await fetch("/api/email/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: toStr, cc: cc || undefined, subject, body: html, invoiceId: g.rows[0]?.inv.id, attachInvoiceIds: attachPdf ? ids : undefined }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); return { ok: false, error: d.error || "Send failed" }; }
      const sentMessageId = (await res.json()).messageId ?? null;
      await Promise.all(g.rows.map(r => fetch("/api/communications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: r.custId, invoiceId: r.inv.id, projectId: r.inv.projectId ?? null,
          direction: "Outbound", channel: "Email", subject, recipients: toStr, body,
          matchedBy: "Manual", isDraft: false, refNumber: emailRef, messageId: sentMessageId,
        }),
      }).catch(() => {})));
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Send failed" };
    }
  }

  async function send() {
    if (sendable.length === 0) { toast?.("None of these invoices have an email on file", "error"); return; }
    if (multiDomain && !ack) { toast?.("Please confirm the split before sending", "error"); return; }
    if (sendable.some(g => !(tos[g.domain] ?? "").trim())) { toast?.("Every group needs at least one recipient", "error"); return; }
    setSending(true);
    let ok = 0; let failed = 0;
    for (const g of sendable) {
      const r = await sendGroup(g, tos[g.domain].trim());
      if (r.ok) ok++; else { failed++; toast?.(`${g.domain}: ${r.error}`, "error"); }
    }
    setSending(false);
    if (ok > 0) {
      const skipped = noEmailGroup ? ` · ${noEmailGroup.rows.length} skipped (no email)` : "";
      toast?.(`Sent ${ok} email${ok !== 1 ? "s" : ""}${failed ? ` · ${failed} failed` : ""}${skipped}`);
      onSent();
    }
  }

  const inputCls = "w-full mt-1 text-sm border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 placeholder-stone-600 outline-none focus:ring-1 focus:ring-emerald-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-stone-900 border border-stone-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-white">
              Send {rows.length} invoice{rows.length !== 1 ? "s" : ""}
              {multiDomain && <span className="text-stone-400 font-normal"> · {sendable.length} recipients</span>}
            </h3>
            <div className="text-[11px] text-stone-400 mt-0.5">Email reference: <span className="font-mono text-emerald-400">{emailRef}</span></div>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-200"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3">
          {/* Novation / multi-domain safety */}
          {multiDomain && (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/40 px-3 py-2.5 text-[12px] text-rose-200 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-rose-400" />
                <div>
                  These invoices belong to <strong>{sendable.length} different domains</strong> — likely a novated project.
                  They'll be sent as <strong>separate emails</strong>, each containing only its own invoices, so no party sees another's.
                </div>
              </div>
              <label className="flex items-center gap-2 pl-6 text-rose-100 cursor-pointer">
                <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="rounded border-rose-400" />
                I've reviewed the recipients below and confirm the split.
              </label>
            </div>
          )}
          {noEmailGroup && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[12px] text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
              {noEmailGroup.rows.length} invoice{noEmailGroup.rows.length !== 1 ? "s have" : " has"} no email on file and will be skipped.
            </div>
          )}

          {/* Per-domain recipient groups (or a single To when one domain) */}
          {sendable.map(g => (
            <div key={g.domain} className={multiDomain ? "rounded-lg border border-stone-800 bg-stone-800/40 p-3 space-y-1.5" : ""}>
              {multiDomain && (
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-stone-200">@{g.domain}</span>
                  <span className="text-[11px] text-stone-500">{g.rows.length} invoice{g.rows.length !== 1 ? "s" : ""} · {g.rows.map(r => `#${r.inv.invoiceNumber}`).slice(0, 4).join(", ")}{g.rows.length > 4 ? "…" : ""}</span>
                </div>
              )}
              <label className="text-[11px] font-medium text-stone-400">{multiDomain ? "To (this domain)" : "To"}</label>
              <input
                value={tos[g.domain] ?? ""}
                onChange={e => setTos(p => ({ ...p, [g.domain]: e.target.value }))}
                placeholder="email@example.com, another@example.com"
                className={inputCls}
              />
            </div>
          ))}

          <div>
            <label className="text-[11px] font-medium text-stone-400">CC {multiDomain && <span className="text-stone-600">(applied to every email)</span>}</label>
            <input value={cc} onChange={e => setCc(e.target.value)} placeholder="optional" className={inputCls} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-stone-400">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-stone-400">Message</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} className={`${inputCls} resize-none`} />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-stone-800 bg-stone-800/40 px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium text-stone-200">Attach invoice PDF</div>
              <div className="text-[11px] text-stone-500">{attachPdf ? "Each invoice PDF will be attached." : "No PDFs attached — statement only."}</div>
            </div>
            <button type="button" role="switch" aria-checked={attachPdf} onClick={() => setAttachPdf(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${attachPdf ? "bg-emerald-600" : "bg-stone-600"}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${attachPdf ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-stone-800 bg-stone-800/40 px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium text-stone-200">Include customer portal link</div>
              <div className="text-[11px] text-stone-500">{includePortal ? "A \"View & Respond\" button will be included." : "No portal link — recipients reply by email only."}</div>
            </div>
            <button type="button" role="switch" aria-checked={includePortal} onClick={() => setIncludePortal(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${includePortal ? "bg-emerald-600" : "bg-stone-600"}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${includePortal ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          <p className="text-[11px] text-stone-500">Sent in the standard branded format with an invoice table. The text above is the intro message.</p>
        </div>

        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-stone-400 hover:text-stone-200">Cancel</button>
          <button onClick={send} disabled={sending || (multiDomain && !ack) || sendable.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {sending && <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            <Send size={14} /> {sending ? "Sending…" : multiDomain ? `Send ${sendable.length} emails` : "Send email"}
          </button>
        </div>
      </div>
    </div>
  );
}
