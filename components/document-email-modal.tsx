"use client";

/**
 * "Email this document" — QBO form-parity, Phase 2 (Email/Send inline).
 *
 * Self-contained: given only {kind, id}, it fetches the document's own
 * print-ready shape from the SAME endpoint the /print/... preview pages use
 * (GET /api/print/document — already resolves company name, party email,
 * and the document's label/number), prefills To/Subject/Body from it, and
 * sends through the shared /api/email/send route with `attachDocument` so
 * the server attaches the exact PDF Download PDF would produce. No new data
 * plumbing — every piece here is something the Print/Download work already
 * built.
 *
 * Reusable from any document that has a party and a PDF: wired into
 * components/new-document-form.tsx for trade documents (Estimate/Purchase
 * Order/Sales Order, which have no detail page of their own) and into
 * app/(app)/accounting/transactions/[id]/page.tsx for native ledger
 * documents (Invoice/Sales Receipt/Credit Note/Refund Receipt/Payment/Bill
 * Payment). Bill/Expense/Supplier Credit are deliberately NOT wired to this —
 * they're purchase documents received FROM a supplier, not sent to one,
 * matching QBO's own action bar (no "Send" on a Bill there either).
 */

import { useEffect, useState } from "react";
import { Send, Loader, AlertTriangle, Check } from "lucide-react";
import { Modal, Button } from "@/components/ui";
import { Field, control, controlMultiline } from "@/components/form-kit";

type Props = {
  kind: "ledger" | "trade";
  id: string;
  onClose: () => void;
};

export function DocumentEmailModal({ kind, id, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [label, setLabel] = useState("Document");
  const [docNumber, setDocNumber] = useState<string | null>(null);

  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/print/document?kind=${kind}&id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (!d?.doc) { setLoadErr(d?.error || "Could not load this document."); return; }
        const companyName = d.company?.name || "";
        const docLabel = (d.doc.label || "Document").replace(/\b\w/g, (c: string) => c.toUpperCase());
        setLabel(docLabel);
        setDocNumber(d.doc.docNumber ?? null);
        setTo(d.party?.email || "");
        setSubject(`${docLabel}${d.doc.docNumber ? ` ${d.doc.docNumber}` : ""}${companyName ? ` from ${companyName}` : ""}`);
        const greeting = d.party?.name ? `Hi ${d.party.name.split(" ")[0]},` : "Hi,";
        setBody(
          `${greeting}\n\nPlease find attached ${docLabel.toLowerCase()}${d.doc.docNumber ? ` ${d.doc.docNumber}` : ""}.` +
          `\n\nKind regards,\n${companyName}`,
        );
      })
      .catch(() => { if (!cancelled) setLoadErr("Could not load this document."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, id]);

  async function send() {
    if (!to.trim()) { setSendErr("Enter at least one recipient."); return; }
    setSending(true); setSendErr("");
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to, cc: cc.trim() || undefined, subject, body,
          attachDocument: { kind, id, filename: `${label}${docNumber ? `-${docNumber}` : ""}.pdf` },
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setSendErr(d.error || "Failed to send email."); return; }
      setSent(true);
    } finally {
      setSending(false);
    }
  }

  const title = `Email ${label.toLowerCase()}${docNumber ? ` ${docNumber}` : ""}`;

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        sent ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button icon={Send} onClick={send} disabled={sending || loading || !!loadErr}>
              {sending ? "Sending…" : "Send"}
            </Button>
          </>
        )
      }
    >
      <div className="p-5 space-y-3">
        {loading ? (
          <div className="py-8 text-center text-stone-500 text-[13px] inline-flex items-center gap-2 w-full justify-center">
            <Loader size={14} className="animate-spin" /> Loading…
          </div>
        ) : loadErr ? (
          <div className="text-[12px] text-rose-400 bg-rose-950/40 border border-rose-900 rounded-lg px-3 py-2 inline-flex items-center gap-2">
            <AlertTriangle size={13} /> {loadErr}
          </div>
        ) : sent ? (
          <div className="text-[13px] text-emerald-400 inline-flex items-center gap-2">
            <Check size={14} /> Sent to {to}.
          </div>
        ) : (
          <>
            {sendErr && (
              <div className="text-[12px] text-rose-400 bg-rose-950/40 border border-rose-900 rounded-lg px-3 py-2 inline-flex items-center gap-2">
                <AlertTriangle size={13} /> {sendErr}
              </div>
            )}
            <Field label="To" required>
              <input className={control} value={to} onChange={e => setTo(e.target.value)} placeholder="name@example.com" />
            </Field>
            <Field label="Cc">
              <input className={control} value={cc} onChange={e => setCc(e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Subject" required>
              <input className={control} value={subject} onChange={e => setSubject(e.target.value)} />
            </Field>
            <Field label="Message" required>
              <textarea className={controlMultiline} rows={8} value={body} onChange={e => setBody(e.target.value)} />
            </Field>
            <p className="text-[11px] text-stone-500">The {label.toLowerCase()} PDF is attached automatically.</p>
          </>
        )}
      </div>
    </Modal>
  );
}
