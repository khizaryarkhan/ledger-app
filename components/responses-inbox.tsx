"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { AlertOctagon, CalendarClock, Check, X, Loader, Inbox as InboxIcon, ExternalLink } from "lucide-react";

type Dispute = {
  id: string; invoiceId: string; invoiceNumber: string; customerName: string | null;
  projectName: string | null; category: string; reason: string | null; source: string;
  status: string; outcome: string | null; resolution: string | null; createdAt: string;
  raisedByName: string | null; assignedToName: string | null; assignedTo: string | null;
};
type Assignee = { id: string; name: string };

const DISPUTE_OUTCOMES = ["Invoice corrected", "Credit issued", "Customer agreed to pay", "Written off"];
type Promise_ = {
  id: string; invoiceId: string; invoiceNumber: string; customerName: string | null;
  projectName: string | null; promiseDate: string; amount: number | null; currency: string;
  source: string; status: string; note: string | null; createdAt: string;
  enteredByName: string | null; isBroken: boolean;
};
type Data = {
  disputes: Dispute[]; promises: Promise_[];
  counts: { needsAttention: number; openDisputes: number; activePromises: number; brokenPromises: number };
};

const sourceBadge = (s: string) => s === "Customer Portal" ? "blue" : s === "Accountant" ? "yellow" : "neutral";
const money = (n: number, ccy: string) => new Intl.NumberFormat("en-IE", { style: "currency", currency: ccy || "EUR", maximumFractionDigits: 0 }).format(n);

export function ResponsesInbox({ invoiceHref = (id: string) => `/invoices/${id}`, linkInvoices = true }: { invoiceHref?: (id: string) => string; linkInvoices?: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"attention" | "promises" | "disputes" | "all">("attention");
  const [busy, setBusy] = useState<string | null>(null);
  // Inline action panel state: which dispute + mode + form fields
  const [action, setAction] = useState<{ id: string; mode: "resolve" | "reject" } | null>(null);
  const [outcome, setOutcome] = useState(DISPUTE_OUTCOMES[0]);
  const [note, setNote] = useState("");

  const [assignees, setAssignees] = useState<Assignee[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/responses");
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/responses/assignees").then(r => r.ok ? r.json() : null).then(d => { if (d?.assignees) setAssignees(d.assignees); }).catch(() => {});
  }, []);

  async function reassign(id: string, assignedTo: string) {
    await patchDispute(id, { assignedTo: assignedTo || null });
  }

  async function patchDispute(id: string, body: any) {
    setBusy(id);
    try {
      await fetch(`/api/disputes/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
    } finally { setBusy(null); }
  }

  function openAction(id: string, mode: "resolve" | "reject") {
    setAction({ id, mode }); setOutcome(DISPUTE_OUTCOMES[0]); setNote("");
  }

  async function submitAction() {
    if (!action) return;
    const body = action.mode === "resolve"
      ? { status: "Resolved", outcome, resolution: note }
      : { status: "Rejected", outcome: "Rejected", resolution: note };
    await patchDispute(action.id, body);
    setAction(null);
  }

  if (loading) return <div className="text-stone-400 text-sm py-8 text-center">Loading…</div>;
  if (!data) return null;

  // Invoice label — a link in the main app, plain text in the rep portal (no detail page there)
  const Inv = ({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) =>
    linkInvoices ? <Link href={invoiceHref(id)} className={className}>{children}</Link> : <span className={className}>{children}</span>;

  const openDisputes = data.disputes.filter(d => d.status === "Open" || d.status === "Under Review");
  const brokenPromises = data.promises.filter(p => p.isBroken);
  const activePromises = data.promises.filter(p => p.status === "Active");

  const TABS = [
    { id: "attention", label: "Needs attention", count: data.counts.needsAttention },
    { id: "promises",  label: "Promises",        count: data.counts.activePromises },
    { id: "disputes",  label: "Disputes",        count: data.counts.openDisputes },
    { id: "all",       label: "All activity",    count: data.disputes.length + data.promises.length },
  ];

  const DisputeRow = ({ d }: { d: Dispute }) => {
    const isOpen = d.status === "Open" || d.status === "Under Review";
    const isActioning = action?.id === d.id;
    return (
      <div className={`p-3.5 rounded-lg border ${isOpen ? "bg-rose-500/10 border-rose-500/30" : "bg-stone-900 border-stone-800"}`}>
        <div className="flex items-start gap-3">
          <AlertOctagon size={16} className={isOpen ? "text-rose-400 mt-0.5 shrink-0" : "text-stone-500 mt-0.5 shrink-0"} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Inv id={d.invoiceId} className="text-sm font-medium text-white hover:underline font-mono">#{d.invoiceNumber}</Inv>
              <span className="text-sm text-stone-500">·</span>
              <span className="text-sm text-stone-300">{d.customerName}{d.projectName ? ` / ${d.projectName}` : ""}</span>
              <Badge variant="red" size="sm">Dispute · {d.category}</Badge>
              <Badge variant={sourceBadge(d.source)} size="sm">{d.source}</Badge>
              <Badge variant={d.status === "Open" ? "red" : d.status === "Under Review" ? "yellow" : "green"} size="sm">{d.status}</Badge>
              {d.outcome && <Badge variant="neutral" size="sm">{d.outcome}</Badge>}
            </div>
            {d.reason && <div className="text-[13px] text-stone-400 mt-1">{d.reason}</div>}
            {d.resolution && <div className="text-[12px] text-stone-500 mt-1 italic">Resolution: {d.resolution}</div>}
            <div className="text-[11px] text-stone-500 mt-1 flex items-center gap-1.5 flex-wrap">
              <span>{d.raisedByName ? `by ${d.raisedByName}` : "via portal"} · {new Date(d.createdAt).toLocaleDateString()}</span>
              {isOpen && assignees.length > 0 ? (
                <span className="flex items-center gap-1">· assigned to
                  <select
                    value={d.assignedTo ?? ""}
                    onChange={e => reassign(d.id, e.target.value)}
                    className="text-[11px] border border-stone-700 rounded px-1 py-0.5 bg-stone-800 text-stone-300 max-w-[140px]"
                  >
                    <option value="">Unassigned</option>
                    {assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </span>
              ) : d.assignedToName ? (
                <span>· assigned to <span className="text-stone-400 font-medium">{d.assignedToName}</span></span>
              ) : null}
            </div>
          </div>
          {isOpen && !isActioning && (
            <div className="flex items-center gap-1.5 shrink-0">
              {busy === d.id ? <Loader size={14} className="animate-spin text-stone-400" /> : (
                <>
                  {d.status === "Open" && (
                    <button onClick={() => patchDispute(d.id, { status: "Under Review" })} title="Acknowledge — start review"
                      className="px-2 py-1 rounded-md bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/20 text-[11px] font-semibold">Acknowledge</button>
                  )}
                  <button onClick={() => openAction(d.id, "resolve")} title="Resolve" className="px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/20 text-[11px] font-semibold flex items-center gap-1"><Check size={12} /> Resolve</button>
                  <button onClick={() => openAction(d.id, "reject")} title="Reject" className="px-2 py-1 rounded-md bg-stone-700 text-stone-300 hover:bg-stone-600 text-[11px] font-semibold flex items-center gap-1"><X size={12} /> Reject</button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Inline action panel */}
        {isActioning && (
          <div className="mt-3 pt-3 border-t border-stone-700 space-y-2">
            {action!.mode === "resolve" && (
              <div>
                <label className="text-[11px] font-medium text-stone-400">Outcome</label>
                <select value={outcome} onChange={e => setOutcome(e.target.value)}
                  className="w-full mt-1 text-sm border border-stone-700 rounded-lg px-2.5 py-1.5 bg-stone-800 text-white outline-none focus:border-emerald-500">
                  {DISPUTE_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            )}
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder={action!.mode === "resolve" ? "Resolution note (optional)" : "Reason for rejecting (optional)"}
              className="w-full text-sm border border-stone-700 rounded-lg px-2.5 py-1.5 bg-stone-800 text-white placeholder-stone-500 outline-none focus:border-emerald-500 resize-none" />
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setAction(null)} className="px-3 py-1.5 text-xs font-medium text-stone-400 hover:text-white">Cancel</button>
              <button onClick={submitAction} disabled={busy === d.id}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md text-white disabled:opacity-50 ${action!.mode === "resolve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-stone-700 hover:bg-stone-800"}`}>
                {busy === d.id ? "Saving…" : action!.mode === "resolve" ? "Confirm resolve" : "Confirm reject"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const PromiseRow = ({ p }: { p: Promise_ }) => (
    <div className={`flex items-start gap-3 p-3.5 rounded-lg border ${p.isBroken ? "bg-amber-500/10 border-amber-500/30" : "bg-stone-900 border-stone-800"}`}>
      <CalendarClock size={16} className={p.isBroken ? "text-amber-400 mt-0.5 shrink-0" : "text-blue-400 mt-0.5 shrink-0"} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Inv id={p.invoiceId} className="text-sm font-medium text-white hover:underline font-mono">#{p.invoiceNumber}</Inv>
          <span className="text-sm text-stone-500">·</span>
          <span className="text-sm text-stone-300">{p.customerName}{p.projectName ? ` / ${p.projectName}` : ""}</span>
          <Badge variant={sourceBadge(p.source)} size="sm">{p.source}</Badge>
          {p.isBroken && <Badge variant="yellow" size="sm">⚠ Broken</Badge>}
          {p.status !== "Active" && <Badge variant="neutral" size="sm">{p.status}</Badge>}
        </div>
        <div className="text-[13px] text-stone-300 mt-1">
          Promised <strong className="text-white">{p.amount != null ? money(p.amount, p.currency) : "full balance"}</strong> by <strong className="text-white">{p.promiseDate}</strong>
          {p.note ? <span className="text-stone-500"> — {p.note}</span> : null}
        </div>
        <div className="text-[11px] text-stone-500 mt-1">{p.enteredByName ? `by ${p.enteredByName}` : "via portal"} · {new Date(p.createdAt).toLocaleDateString()}</div>
      </div>
      {linkInvoices && <Link href={invoiceHref(p.invoiceId)} className="p-1.5 text-stone-500 hover:text-stone-300 shrink-0"><ExternalLink size={14} /></Link>}
    </div>
  );

  // Build the visible list per tab, newest-first
  let content: React.ReactNode;
  if (tab === "attention") {
    const items = [
      ...openDisputes.map(d => ({ t: "d" as const, when: d.createdAt, node: <DisputeRow key={`d${d.id}`} d={d} /> })),
      ...brokenPromises.map(p => ({ t: "p" as const, when: p.createdAt, node: <PromiseRow key={`p${p.id}`} p={p} /> })),
    ].sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
    content = items.length ? items.map(i => i.node) : <EmptyState icon={Check} title="All clear" description="No open disputes or broken promises. Nice." />;
  } else if (tab === "promises") {
    content = activePromises.length ? activePromises.map(p => <PromiseRow key={p.id} p={p} />) : <EmptyState icon={CalendarClock} title="No active promises" description="Promises customers make will appear here." />;
  } else if (tab === "disputes") {
    content = data.disputes.length ? data.disputes.map(d => <DisputeRow key={d.id} d={d} />) : <EmptyState icon={AlertOctagon} title="No disputes" description="Disputes raised by customers or staff appear here." />;
  } else {
    const items = [
      ...data.disputes.map(d => ({ when: d.createdAt, node: <DisputeRow key={`d${d.id}`} d={d} /> })),
      ...data.promises.map(p => ({ when: p.createdAt, node: <PromiseRow key={`p${p.id}`} p={p} /> })),
    ].sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
    content = items.length ? items.map(i => i.node) : <EmptyState icon={InboxIcon} title="No responses yet" description="Customer responses will show up here." />;
  }

  return (
    <div>
      <div className="border-b border-stone-800 mb-4">
        <div className="flex items-center gap-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 transition-colors ${tab === t.id ? "border-emerald-500 text-white" : "border-transparent text-stone-500 hover:text-stone-200"}`}>
              {t.label}
              {t.count > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${t.id === "attention" ? "bg-rose-500 text-white" : "bg-stone-800 text-stone-300"}`}>{t.count}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">{content}</div>
    </div>
  );
}
