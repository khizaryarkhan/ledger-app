"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { X, Loader, Receipt, ArrowRight, AlertTriangle, Check, Printer, Download, Trash2, Mail, Repeat } from "lucide-react";
import { txnTypeLabel, formatTxnId } from "@/lib/accounting/doc-format";
import { NewDocumentForm, type DocType } from "@/components/new-document-form";
import { DocumentEmailModal } from "@/components/document-email-modal";
import { DocumentAttachmentsPanel } from "@/components/document-attachments-panel";
import { DocumentAuditPanel } from "@/components/document-audit-panel";
import { MakeRecurringModal } from "@/components/make-recurring-modal";
import { RECURRABLE_TYPES } from "@/lib/accounting/recurring";

const LINE_EDITABLE = new Set(["Invoice", "SalesReceipt", "CreditNote", "RefundReceipt", "Bill", "Expense", "VendorCredit"]);
const PAYMENT_EDITABLE = new Set(["Payment", "BillPayment"]);
// QBO form-parity, Phase 2 — "Email this document" from the form itself.
// Scoped to documents that go OUT to a party: sales documents to a customer,
// Payment/BillPayment as a receipt/remittance. Bill/Expense/VendorCredit are
// deliberately excluded — those are purchase documents received FROM a
// supplier, and QBO's own action bar offers no "Send" on a Bill either.
const EMAILABLE = new Set(["Invoice", "SalesReceipt", "CreditNote", "RefundReceipt", "Payment", "BillPayment"]);

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A related-transaction link's `id` is only safe to open at
// /accounting/transactions/[id] when its type is itself a posted GL entry.
// GoodsReceipt/PurchaseOrder/Estimate are non-posting trade/receipt documents
// whose `id` points at a different table (goods_receipts / trade_documents)
// with no confirmed standalone detail page (see CLAUDE.md's "known,
// deliberate duplication" + Supplier Transactions notes) — linking those here
// 404s. SalesOrder is the one trade-doc kind that DOES have a real page.
// Render the rest as plain, non-clickable rows, the same "viewHref: null"
// rule the Supplier/Customer transaction feeds already use for these types.
const NO_DETAIL_PAGE = new Set(["GoodsReceipt", "PurchaseOrder", "Estimate"]);

function relatedRow(lk: any, i: number) {
  const inner = (
    <>
      <span className="text-stone-500 w-20">{lk.relation === "progress_invoice" ? "invoiced" : lk.relation === "po_bill" ? "billed" : lk.relation === "deposit_sweep" ? "swept" : lk.relation}</span>
      <ArrowRight size={12} className="text-stone-600" />
      <span className="font-mono text-stone-300">{lk.docNumber}</span>
      <span className="text-stone-500">{txnTypeLabel(lk.type)}</span>
      <span className="tabular-nums text-stone-300 ml-auto">{money(lk.linkedAmount)}</span>
    </>
  );
  if (NO_DETAIL_PAGE.has(lk.type)) {
    return (
      <div key={i} className="flex items-center gap-3 text-[12px] rounded-lg px-3 py-2 bg-stone-900 border border-stone-800 opacity-80 cursor-default" title="No detail page for this document yet">
        {inner}
      </div>
    );
  }
  const href = lk.type === "SalesOrder" ? `/accounting/trade/sales-orders/${lk.id}` : `/accounting/transactions/${lk.id}`;
  return (
    <Link key={i} href={href} className="flex items-center gap-3 text-[12px] rounded-lg px-3 py-2 bg-stone-900 border border-stone-800 hover:border-stone-600">
      {inner}
    </Link>
  );
}

export default function TransactionDetailPage() {
  const id = String(useParams().id || "");
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);

  async function load() {
    const r = await fetch(`/api/ledger/journal/${id}`).then(x => x.json()).catch(() => null);
    if (r?.entry) setData(r); else setErr(r?.error || "Not found");
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const close = () => router.back();
  const e = data?.entry;
  const reversed = e?.status === "Reversed";
  const isReversal = e?.sourceType === "Reversal";
  // A correction is only blocked when money has actually been SETTLED
  // against this document (a payment or credit applied) — a provenance link
  // (the PO/GRN this document came from) is history, not a reason to lock
  // it. Mirrors lib/accounting/documents.ts's hasSettlementLink exactly, so
  // the button the user sees and the server's own check never disagree.
  const hasSettlementLink = (data?.links ?? []).some((l: any) => l.relation === "payment" || l.relation === "credit");
  const canEdit = e && !reversed && !isReversal && (
    (LINE_EDITABLE.has(e.sourceType) && !hasSettlementLink) ||          // line-item doc (payload stored or reconstructed)
    (PAYMENT_EDITABLE.has(e.sourceType) && e.hasPayload)               // payments (reallocate / correct)
  );
  const canDelete = e && !reversed && !isReversal && e.sourceType !== "Closing" && !hasSettlementLink;
  // Payment/BillPayment print as a receipt/remittance built from what they
  // settled (lib/accounting/document-print.ts), not from their journal lines
  // — so they're printable even without a stored payload, unlike canEdit.
  // Deposit's payload lines are already in the generic {accountId, amount,
  // description} shape document-print.ts's decorateLines expects, so it
  // prints cleanly too. Manual (Journal Entry) and Transfer print as a
  // voucher (Account/Name/Description/Debit/Credit table) instead of the
  // invoice-shaped template — see document-print.ts's VOUCHER_TYPES.
  // Closing/Reversal/adjustments are still not here — they're system-
  // generated entries nobody needs a printable copy of.
  const canPrint = e && (LINE_EDITABLE.has(e.sourceType) || PAYMENT_EDITABLE.has(e.sourceType) || e.sourceType === "Deposit" || e.sourceType === "Manual" || e.sourceType === "Transfer");
  const canEmail = e && EMAILABLE.has(e.sourceType);
  const canRecur = e && RECURRABLE_TYPES.has(e.sourceType) && !reversed && !isReversal;
  // Opening a posted transaction shows the SAME form it was entered on
  // (QBO/QBD parity) for every type that form already knows how to edit —
  // reusing that exact, already-proven data path, open DIRECTLY editable
  // (readOnly={!canEdit} below) when nothing blocks it — no separate "Edit"
  // click, matching QBO. Types with no original form (manual Journal Entry,
  // Closing, Reversal, stock-count/write-down adjustments, …) keep the
  // generic debit/credit ledger view below, which is always read-only.
  //
  // A line-item doc's payload is reconstructed from its journal lines when
  // missing (documentPayload → reconstructLineItemPayload), so it's always
  // safe. A Payment/BillPayment has no such reconstruction — without a
  // stored payload the form would render as misleadingly blank, so those
  // fall back to the ledger view, exactly mirroring canEdit's own
  // hasPayload condition above.
  const showFormView = e && (
    LINE_EDITABLE.has(e.sourceType) ||
    (PAYMENT_EDITABLE.has(e.sourceType) && e.hasPayload)
  );

  async function del() {
    if (!confirm("Delete this transaction permanently? This removes it from the ledger.")) return;
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/ledger/journal/${id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || "Failed to delete"); return; }
      close();
    } finally { setBusy(false); }
  }

  // No entry yet (loading or not found) — a simple shell, same as before this
  // page could ever render the real form or ledger views.
  if (!e) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end">
        <div className="absolute inset-0 bg-black/50" onClick={close} />
        <div className="relative h-full w-full sm:w-[92vw] max-w-[1000px] bg-stone-950 border-l border-stone-800 shadow-2xl flex flex-col items-center justify-center gap-3">
          {err ? (
            <div className="text-[13px] text-rose-400 inline-flex items-center gap-2"><AlertTriangle size={14} /> {err}</div>
          ) : (
            <div className="text-stone-500 text-sm inline-flex items-center gap-2"><Loader size={14} className="animate-spin" /> Loading…</div>
          )}
          <button onClick={close} className="text-stone-500 hover:text-stone-200 text-[12px]">Close</button>
        </div>
      </div>
    );
  }

  // Status pill — stays in the header (it's a status indicator, not an
  // action). Shown separately from `actions` below, which NewDocumentForm
  // now renders in the bottom bar alongside Save/Cancel, not up here — one
  // action bar per form, not two (the user's own "only use the bottom line"
  // request).
  const statusBadge = (
    <span className={`text-[11px] font-medium border rounded-full px-2 py-0.5 ${reversed ? "bg-amber-500/10 text-amber-400 border-amber-800" : "bg-emerald-500/12 text-emerald-400 border-emerald-800/50"}`}>{e.status}</span>
  );
  // Download/Print/Email/Make recurring/Delete — Edit is gone (the form
  // opens directly editable via readOnly={!canEdit} below, no separate
  // click) and Reverse is gone entirely (removed per explicit request —
  // correcting a document now means Edit or Delete; a document with a
  // payment/credit actually applied simply can't be corrected here until
  // that's removed first, which is deliberate, not a gap).
  const actions = (
    <div className="flex items-center gap-2">
      {canPrint && (
        <>
          <a href={`/api/print/pdf?kind=ledger&id=${e.id}`}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm font-medium">
            <Download size={14} /> Download PDF
          </a>
          <a href={`/print/invoice/${e.id}`} target="_blank" rel="noopener noreferrer"
            title="Open the printable page in a new tab (uses your browser's own print dialog)"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm font-medium">
            <Printer size={14} /> Print
          </a>
        </>
      )}
      {canEmail && (
        <button onClick={() => setEmailOpen(true)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm font-medium">
          <Mail size={14} /> Email
        </button>
      )}
      {canRecur && (
        <button onClick={() => setRecurringOpen(true)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm font-medium">
          <Repeat size={14} /> Make recurring
        </button>
      )}
      {canDelete && (
        <button onClick={del} disabled={busy} title="Delete permanently"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-800/60 text-rose-400 hover:bg-rose-500/10 text-sm font-medium disabled:opacity-40">
          <Trash2 size={14} /> Delete
        </button>
      )}
    </div>
  );

  if (showFormView) {
    const related = data.links.length > 0 && (
      <div className="max-w-[1200px] mt-2">
        <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">Related transactions</div>
        <div className="space-y-1">
          {data.links.map((lk: any, i: number) => relatedRow(lk, i))}
        </div>
      </div>
    );
    return (
      <NewDocumentForm
        type={e.sourceType as DocType}
        editId={e.id}
        readOnly={!canEdit}
        headerBadge={statusBadge}
        actions={actions}
        afterContent={
          <>
            {msg && <div className="max-w-[1200px] mb-3 text-[12px] text-emerald-400 inline-flex items-center gap-1.5 bg-emerald-950/30 border border-emerald-900 rounded-lg px-3 py-2"><Check size={13} /> {msg}</div>}
            {related}
            <DocumentAttachmentsPanel kind="ledger" id={e.id} />
            <DocumentAuditPanel kind="ledger" id={e.id} />
            {emailOpen && <DocumentEmailModal kind="ledger" id={e.id} onClose={() => setEmailOpen(false)} />}
            {recurringOpen && <MakeRecurringModal sourceEntryId={e.id} sourceType={e.sourceType} docNumber={e.docNumber} onClose={() => setRecurringOpen(false)} />}
          </>
        }
      />
    );
  }

  // Generic ledger view — types with no original form (manual Journal Entry,
  // Closing, Reversal, stock-count/write-down adjustments, …).
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={close} />
      <div className="relative h-full w-full sm:w-[92vw] max-w-[1000px] bg-stone-950 border-l border-stone-800 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-stone-800 bg-stone-900 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-teal-500/15 flex items-center justify-center shrink-0"><Receipt size={17} className="text-teal-400" /></div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-stone-100 leading-tight truncate">
                {`${txnTypeLabel(e.sourceType)} ${e.docNumber ?? `JE-${e.entryNumber}`}`}
              </h1>
              <p className="text-[11px] text-stone-500 truncate">{formatTxnId(e.txnNo)} · {e.entryDate}{e.dueDate ? ` · due ${e.dueDate}` : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {statusBadge}
            <button onClick={close} className="text-stone-500 hover:text-stone-200 p-1"><X size={20} /></button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {msg && <div className="text-[12px] text-emerald-400 inline-flex items-center gap-1.5 bg-emerald-950/30 border border-emerald-900 rounded-lg px-3 py-2"><Check size={13} /> {msg}</div>}
          {(e.reference || e.memo) && (
            <div className="flex flex-wrap gap-x-10 gap-y-1 text-[13px]">
              {e.reference && <div><span className="text-stone-500">Reference: </span><span className="text-stone-200">{e.reference}</span></div>}
              {e.memo && <div><span className="text-stone-500">Memo: </span><span className="text-stone-200">{e.memo}</span></div>}
            </div>
          )}

          {/* Double-entry lines */}
          <div className="rounded-xl border border-stone-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] min-w-[640px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                    <th className="text-left px-4 py-2">Account</th>
                    <th className="text-left px-4 py-2">Name</th>
                    <th className="text-left px-4 py-2">Description</th>
                    <th className="text-right px-4 py-2">Debit</th>
                    <th className="text-right px-4 py-2">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l: any, i: number) => (
                    <tr key={i} className="border-b border-stone-800/50">
                      <td className="px-4 py-2 text-stone-200">{l.account}</td>
                      <td className="px-4 py-2 text-stone-400">{l.name || "—"}</td>
                      <td className="px-4 py-2 text-stone-400">{l.description || "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-stone-300">{l.debit ? money(l.debit) : ""}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-stone-300">{l.credit ? money(l.credit) : ""}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-stone-800 font-semibold text-white">
                    <td className="px-4 py-2" colSpan={3}>Total</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(data.total)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(data.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Related transactions */}
          {data.links.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">Related transactions</div>
              <div className="space-y-1">
                {data.links.map((lk: any, i: number) => relatedRow(lk, i))}
              </div>
            </div>
          )}

          <DocumentAttachmentsPanel kind="ledger" id={e.id} />
          <DocumentAuditPanel kind="ledger" id={e.id} />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-stone-800 bg-stone-900 shrink-0">
          <p className="text-[11px] text-stone-500 max-w-xs">Delete removes this entry from the ledger permanently.</p>
          {actions}
        </div>
      </div>
      {emailOpen && <DocumentEmailModal kind="ledger" id={e.id} onClose={() => setEmailOpen(false)} />}
    </div>
  );
}
