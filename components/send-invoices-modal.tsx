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

const uniqEmails = (vals: (string | null)[]) => {
  const set = new Set<string>();
  vals.forEach(v => (v || "").split(/[,;]/).map(e => e.trim().toLowerCase()).filter(e => e.includes("@")).forEach(e => set.add(e)));
  return [...set];
};

/**
 * Shared "send invoices" composer — used by the Collections Board (bulk) AND
 * the invoice detail page (single), so the experience is identical everywhere.
 * Sends the branded statement template with the portal link and auto-attaches
 * the invoice PDFs.
 */
export function SendInvoicesModal({ rows, ccy, multiCustomer = false, onClose, onSent, toast }: {
  rows: SendRow[];
  ccy: string;
  multiCustomer?: boolean;
  onClose: () => void;
  onSent: () => void;
  toast?: (m: string, t?: string) => void;
}) {
  const total = rows.reduce((s, r) => s + r.bal, 0);
  // Total currency should match the invoices, not the org's home currency.
  const emailCurrency = rows[0]?.inv?.currency || ccy;
  const [emailRef] = useState(genEmailRef);
  const [to, setTo] = useState(uniqEmails(rows.map(r => r.email)).join(", "));
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(`Open Invoices — Ref ${emailRef}`);
  const [body, setBody] = useState(
    `Hi,\n\nPlease find attached a statement of your open invoices along with copies of each invoice for your reference.\nCould you please share the expected payment dates at your earliest convenience?\nFeel free to reach out if you have any questions.`
  );
  const [attachPdf, setAttachPdf] = useState(true);
  const [includePortal, setIncludePortal] = useState(true);
  const [sending, setSending] = useState(false);

  async function send() {
    if (!to.trim()) { toast?.("Add at least one recipient", "error"); return; }
    setSending(true);
    try {
      const ids = rows.map(r => r.inv.id);
      // Portal link — only when all invoices belong to one customer
      let portalUrl: string | null = null;
      const custIds = new Set(rows.map(r => r.custId));
      if (includePortal && custIds.size === 1) {
        try {
          const tk = await fetch("/api/portal/token", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customerId: rows[0].custId, invoiceIds: ids }),
          });
          if (tk.ok) portalUrl = (await tk.json()).url ?? null;
        } catch {}
      }
      const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      const html = renderInvoiceEmail({
        subject, dateStr, total, currency: emailCurrency, portalUrl, intro: body,
        rows: rows.map(r => ({
          invoiceNumber: r.inv.invoiceNumber, customerName: r.custName, projectName: r.projName,
          invoiceDate: r.inv.invoiceDate, dueDate: r.inv.dueDate, balance: r.bal, currency: r.inv.currency, daysOverdue: r.days,
        })),
      });
      const res = await fetch("/api/email/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // Pass first invoiceId so server can look up In-Reply-To for thread continuity
        body: JSON.stringify({ to, cc: cc || undefined, subject, body: html, invoiceId: rows[0]?.inv.id, attachInvoiceIds: attachPdf ? ids : undefined }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Send failed"); }
      const sentResult = await res.json();
      const sentMessageId = sentResult.messageId ?? null;
      // Await communications logging so refresh() sees the new records (including refNumber)
      // All invoices in this send share the same messageId — needed for reply threading.
      await Promise.all(rows.map(r => fetch("/api/communications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: r.custId, invoiceId: r.inv.id, projectId: r.inv.projectId ?? null,
          direction: "Outbound", channel: "Email", subject, recipients: to, body,
          matchedBy: "Manual", isDraft: false, refNumber: emailRef, messageId: sentMessageId,
        }),
      }).catch(() => {})));
      toast?.(`Sent ${rows.length} invoice(s) to ${to}`);
      onSent();
    } catch (e: any) {
      toast?.(e.message || "Failed to send", "error");
    } finally { setSending(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-stone-900 border border-stone-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-white">Send {rows.length} invoice{rows.length !== 1 ? "s" : ""}</h3>
            <div className="text-[11px] text-stone-400 mt-0.5">Email reference: <span className="font-mono text-emerald-400">{emailRef}</span></div>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-200"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          {multiCustomer && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[12px] text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
              You&apos;ve selected invoices from <strong>different customers</strong> — they&apos;ll all go to the recipients below in one email. Send separately per customer to avoid sharing one customer&apos;s invoices with another.
            </div>
          )}
          <div>
            <label className="text-[11px] font-medium text-stone-400">To</label>
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="email@example.com, another@example.com" className="w-full mt-1 text-sm border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 placeholder-stone-600 outline-none focus:ring-1 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-stone-400">CC</label>
            <input value={cc} onChange={e => setCc(e.target.value)} placeholder="optional" className="w-full mt-1 text-sm border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 placeholder-stone-600 outline-none focus:ring-1 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-stone-400">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full mt-1 text-sm border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-stone-400">Message</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} className="w-full mt-1 text-sm border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500 resize-none" />
          </div>
          {/* Attach invoice PDF toggle */}
          <div className="flex items-center justify-between rounded-lg border border-stone-800 bg-stone-800/40 px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium text-stone-200">Attach invoice PDF</div>
              <div className="text-[11px] text-stone-500">{attachPdf ? "Each invoice PDF will be attached." : "No PDFs attached — statement only."}</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={attachPdf}
              onClick={() => setAttachPdf(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${attachPdf ? "bg-emerald-600" : "bg-stone-600"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${attachPdf ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          {/* Include customer portal link toggle */}
          <div className="flex items-center justify-between rounded-lg border border-stone-800 bg-stone-800/40 px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium text-stone-200">Include customer portal link</div>
              <div className="text-[11px] text-stone-500">{includePortal ? "A \"View & Respond\" button will be included in the email." : "No portal link — recipients reply by email only."}</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={includePortal}
              onClick={() => setIncludePortal(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${includePortal ? "bg-emerald-600" : "bg-stone-600"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${includePortal ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          <p className="text-[11px] text-stone-500">Sent in the standard branded format with an invoice table. The text above is the intro message.</p>
        </div>
        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-stone-400 hover:text-stone-200">Cancel</button>
          <button onClick={send} disabled={sending} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {sending && <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            <Send size={14} /> {sending ? "Sending…" : "Send email"}
          </button>
        </div>
      </div>
    </div>
  );
}
