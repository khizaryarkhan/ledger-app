"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FileText, Loader, RefreshCw, ExternalLink, Ban, CheckCircle2, HandCoins, X,
} from "lucide-react";
import { Card, Badge, Button, Modal, Toast } from "@/components/ui";
import { fmt } from "@/lib/format";

type Invoice = {
  id: string; number: string | null; status: string;
  total: number; amountDue: number; amountPaid: number; currency: string;
  created: number | null; dueDate: number | null;
  hostedInvoiceUrl: string | null; invoicePdf: string | null;
  orgName: string; orgId: string | null;
  customerEmail: string | null; description: string | null;
  isSubscription: boolean; paidMethod: string | null; paidNote: string | null; paidOutOfBand: boolean;
};

const STATUS_BADGE: Record<string, string> = {
  paid: "green", open: "blue", draft: "neutral", void: "neutral", uncollectible: "red",
};

const METHOD_LABEL: Record<string, string> = {
  bank_transfer: "Bank transfer", cheque: "Cheque", cash: "Cash", card_external: "Card (external)", other: "Other",
};

type Tab = "all" | "open" | "paid" | "draft" | "void";

// ── Mark received (out-of-band) modal ────────────────────────────────────────
function MarkPaidModal({ invoice, onClose, onDone, onToast }: {
  invoice: Invoice | null; onClose: () => void; onDone: () => void; onToast: (t: any) => void;
}) {
  const [method, setMethod] = useState("bank_transfer");
  const [note, setNote]     = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");

  useEffect(() => { if (invoice) { setMethod("bank_transfer"); setNote(""); setErr(""); } }, [invoice]);
  if (!invoice) return null;

  const submit = async () => {
    setErr(""); setSaving(true);
    try {
      const r = await fetch(`/api/admin/billing/invoices/${invoice.id}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "mark_paid", method, note: note.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || "Failed"); return; }
      onToast({ type: "success", message: "Marked as received" });
      onDone(); onClose();
    } catch (e: any) { setErr(e?.message || "Network error"); }
    finally { setSaving(false); }
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

  return (
    <Modal open={!!invoice} onClose={onClose} title="Mark payment received"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={saving}>
          {saving && <Loader size={13} className="animate-spin mr-1" />}{saving ? "Recording…" : "Mark received"}
        </Button>
      </>}>
      <div className="px-5 py-5 space-y-4">
        <div className="text-xs text-stone-400">
          {invoice.orgName} · <span className="text-stone-200">{fmt.money(invoice.total / 100, invoice.currency)}</span>
          {invoice.number ? ` · ${invoice.number}` : ""}
        </div>
        <p className="text-[12px] text-stone-500">
          Records this invoice as paid <b>outside Stripe</b> (no card charge) and notes how it was received. It then counts as paid everywhere.
        </p>
        <div>
          <label className="text-xs text-stone-400 block mb-1.5">How was it received?</label>
          <select value={method} onChange={e => setMethod(e.target.value)} className={inp}>
            {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-stone-400 block mb-1.5">Reference / note <span className="text-stone-600">(optional)</span></label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. BACS ref 12345, received 12 Jun" className={inp} />
        </div>
        {err && <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">{err}</div>}
      </div>
    </Modal>
  );
}

export default function AdminInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<Tab>("all");
  const [toast, setToast]       = useState<any>(null);
  const [markPaid, setMarkPaid] = useState<Invoice | null>(null);
  const [acting, setActing]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/billing/invoices?limit=100");
      const d = await r.json();
      if (r.ok) setInvoices(d.invoices ?? []);
      else setToast({ type: "error", message: d.error ?? `Failed (${r.status})` });
    } catch (e: any) {
      setToast({ type: "error", message: e?.message ?? "Network error" });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const voidInvoice = async (inv: Invoice) => {
    if (!confirm(`Void invoice ${inv.number ?? inv.id}? This cannot be undone.`)) return;
    setActing(inv.id);
    try {
      const r = await fetch(`/api/admin/billing/invoices/${inv.id}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "void" }),
      });
      const d = await r.json();
      if (r.ok) { setToast({ type: "success", message: "Invoice voided" }); load(); }
      else setToast({ type: "error", message: d.error ?? "Failed to void" });
    } finally { setActing(null); }
  };

  const counts = {
    all:   invoices.length,
    open:  invoices.filter(i => i.status === "open").length,
    paid:  invoices.filter(i => i.status === "paid").length,
    draft: invoices.filter(i => i.status === "draft").length,
    void:  invoices.filter(i => i.status === "void" || i.status === "uncollectible").length,
  };
  const filtered = invoices.filter(i =>
    tab === "all" ? true
    : tab === "void" ? (i.status === "void" || i.status === "uncollectible")
    : i.status === tab
  );

  const totalOutstanding = invoices.filter(i => i.status === "open").reduce((s, i) => s + i.amountDue, 0);

  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: "All" }, { key: "open", label: "Open" },
    { key: "paid", label: "Paid" }, { key: "draft", label: "Draft" }, { key: "void", label: "Void" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">Invoices</h1>
          <p className="text-xs text-stone-500 mt-0.5">Every Stripe invoice across all organisations</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200 transition-colors disabled:opacity-40">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-stone-800">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? "border-emerald-500 text-white" : "border-transparent text-stone-500 hover:text-stone-300"
            }`}>
            {t.label}
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-stone-800 text-stone-400">{counts[t.key]}</span>
          </button>
        ))}
        {totalOutstanding > 0 && (
          <span className="ml-auto self-center text-[11px] text-amber-400">
            Outstanding: {fmt.money(totalOutstanding / 100, filtered[0]?.currency || invoices[0]?.currency || "GBP")}
          </span>
        )}
      </div>

      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-stone-800 rounded animate-pulse" />)}</div>
        ) : !filtered.length ? (
          <div className="py-16 text-center">
            <FileText size={28} className="text-stone-600 mx-auto mb-3" />
            <p className="text-sm text-stone-500">No invoices in this view</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-stone-800">
                  {["Organisation", "Invoice", "Amount", "Status", "Created", "Due", "Actions"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] text-stone-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => {
                  const canAct = inv.status === "open" || inv.status === "draft";
                  return (
                    <tr key={inv.id} className="border-b border-stone-800/50 hover:bg-stone-800/25 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-white text-xs font-medium">{inv.orgName}</p>
                        {inv.customerEmail && <p className="text-[11px] text-stone-500 truncate max-w-[180px]">{inv.customerEmail}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-stone-200 text-xs font-mono">{inv.number ?? inv.id.slice(0, 14)}</p>
                        {inv.isSubscription && <span className="text-[10px] text-stone-600">subscription</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-stone-200 tabular-nums whitespace-nowrap">
                        {fmt.money(inv.total / 100, inv.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={(STATUS_BADGE[inv.status] ?? "neutral") as any}>{inv.status}</Badge>
                        {inv.paidOutOfBand && inv.paidMethod && (
                          <p className="text-[10px] text-emerald-500/80 mt-0.5">via {METHOD_LABEL[inv.paidMethod] ?? inv.paidMethod}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-stone-400 whitespace-nowrap">
                        {inv.created ? new Date(inv.created).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-stone-400 whitespace-nowrap">
                        {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {inv.hostedInvoiceUrl && (
                            <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer"
                              className="text-stone-500 hover:text-sky-400 transition-colors p-1" title="Open hosted invoice">
                              <ExternalLink size={13} />
                            </a>
                          )}
                          {canAct && (
                            <>
                              <button onClick={() => setMarkPaid(inv)}
                                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-emerald-700/50 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                                title="Record payment received outside Stripe">
                                <HandCoins size={11} /> Mark received
                              </button>
                              <button onClick={() => voidInvoice(inv)} disabled={acting === inv.id}
                                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-rose-700/50 text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
                                title="Void / cancel invoice">
                                {acting === inv.id ? <Loader size={11} className="animate-spin" /> : <Ban size={11} />} Void
                              </button>
                            </>
                          )}
                          {inv.status === "paid" && <CheckCircle2 size={14} className="text-emerald-500" />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <MarkPaidModal invoice={markPaid} onClose={() => setMarkPaid(null)} onDone={load} onToast={setToast} />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
