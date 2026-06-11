"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { MessageSquare, AlertOctagon, CalendarClock, ArrowUpRight, X, Calendar, CheckCircle2, FileWarning } from "lucide-react";
import { fmt } from "@/lib/format";

interface PromiseItem {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  projectName: string | null;
  promiseDate: string;
  amount: number;
  currency: string;
  source: string;
  status: string;
  note: string | null;
  enteredByName: string | null;
  isBroken: boolean;
}

interface DisputeItem {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  projectName: string | null;
  category: string;
  reason: string | null;
  status: string;
  createdAt: string;
  assignedToName: string | null;
}

interface Counts {
  needsAttention: number;
  openDisputes: number;
  activePromises: number;
  brokenPromises: number;
  unpromisedOverdueCount: number;
  unpromisedByCcy: Record<string, number>;
}

type PanelType = "needs-attention" | "disputes" | "promises" | null;

export function ResponsesDashboardWidget() {
  const [counts, setCounts]     = useState<Counts | null>(null);
  const [promises, setPromises] = useState<PromiseItem[]>([]);
  const [disputes, setDisputes] = useState<DisputeItem[]>([]);
  const [panel, setPanel]       = useState<PanelType>(null);

  useEffect(() => {
    fetch("/api/responses")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.counts)   setCounts(d.counts);
        if (d?.promises) setPromises(d.promises);
        if (d?.disputes) setDisputes(d.disputes);
      })
      .catch(() => {});
  }, []);

  if (!counts || (counts.openDisputes === 0 && counts.activePromises === 0 && counts.brokenPromises === 0 && (counts.unpromisedOverdueCount ?? 0) === 0)) return null;

  const activeItems = promises.filter(p => p.status === "Active" && !p.isBroken)
    .sort((a, b) => a.promiseDate.localeCompare(b.promiseDate));

  const brokenItems = promises.filter(p => p.isBroken);

  const openDisputeItems = disputes.filter(d => d.status === "Open" || d.status === "Under Review");

  // "Needs attention" = open disputes + broken promises
  const attentionItems = [...openDisputeItems.map(d => ({ type: "dispute" as const, item: d })),
                          ...brokenItems.map(p => ({ type: "promise" as const, item: p }))];

  const unpromisedCount   = counts.unpromisedOverdueCount ?? 0;
  const unpromisedByCcy   = counts.unpromisedByCcy ?? {};
  const unpromisedSummary = Object.entries(unpromisedByCcy).sort((a, b) => b[1] - a[1]).map(([c, v]) => fmt.money(v, c)).join(" · ");

  return (
    <>
      <Card padding="md" className="mb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <MessageSquare size={15} className="text-stone-500" />
            <h3 className="text-sm font-semibold text-white">Customer Responses</h3>
          </div>
          <Link href="/responses" className="text-xs text-stone-500 hover:text-stone-200 flex items-center gap-1">
            Open inbox <ArrowUpRight size={12} />
          </Link>
        </div>

        <div className="grid grid-cols-4 gap-3">
          {/* Needs attention */}
          <button
            onClick={() => counts.needsAttention > 0 && setPanel("needs-attention")}
            className={`rounded-lg p-3 text-left transition-all ${counts.needsAttention > 0 ? "bg-rose-900/20 hover:ring-1 hover:ring-rose-700 cursor-pointer" : "bg-stone-800/50 cursor-default"}`}
          >
            <div className="flex items-center gap-1.5 text-[11px] text-stone-500 mb-1">
              <AlertOctagon size={12} /> Needs attention
            </div>
            <div className={`text-2xl font-bold tabular-nums ${counts.needsAttention > 0 ? "text-rose-400" : "text-white"}`}>
              {counts.needsAttention}
            </div>
          </button>

          {/* Open disputes */}
          <button
            onClick={() => counts.openDisputes > 0 && setPanel("disputes")}
            className={`rounded-lg p-3 text-left transition-all ${counts.openDisputes > 0 ? "bg-stone-800/50 hover:ring-1 hover:ring-stone-600 cursor-pointer" : "bg-stone-800/50 cursor-default"}`}
          >
            <div className="flex items-center gap-1.5 text-[11px] text-stone-500 mb-1">
              <AlertOctagon size={12} /> Open disputes
            </div>
            <div className="text-2xl font-bold tabular-nums text-white">{counts.openDisputes}</div>
          </button>

          {/* Active promises */}
          <button
            onClick={() => counts.activePromises > 0 && setPanel("promises")}
            className={`rounded-lg p-3 text-left transition-all ${counts.activePromises > 0 ? "bg-stone-800/50 hover:ring-1 hover:ring-stone-600 cursor-pointer" : "bg-stone-800/50 cursor-default"}`}
          >
            <div className="flex items-center gap-1.5 text-[11px] text-stone-500 mb-1">
              <CalendarClock size={12} /> Active promises
            </div>
            <div className="text-2xl font-bold tabular-nums text-blue-400">{counts.activePromises}</div>
          </button>

          {/* Promise to secure */}
          <div className={`rounded-lg p-3 ${unpromisedCount > 0 ? "bg-amber-900/20" : "bg-stone-800/50"}`}>
            <div className="flex items-center gap-1.5 text-[11px] text-stone-500 mb-1">
              <CheckCircle2 size={12} /> Promise to secure
            </div>
            {unpromisedCount === 0 ? (
              <div className="text-2xl font-bold tabular-nums text-white">0</div>
            ) : (
              <>
                <div className="text-2xl font-bold tabular-nums text-amber-400">{unpromisedCount}</div>
                <div className="text-[11px] text-amber-500/80 leading-snug mt-0.5">{unpromisedSummary}</div>
                <div className="text-[10px] text-stone-600 mt-0.5">overdue invoice{unpromisedCount !== 1 ? "s" : ""} · no promise</div>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* ── Slide-in panel ── */}
      {panel && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setPanel(null)} />
          <div className="fixed right-0 top-0 h-full w-[460px] bg-stone-900 border-l border-stone-800 z-50 flex flex-col shadow-2xl">

            {/* Header */}
            {panel === "promises" && (
              <PanelHeader
                title="Active Promises"
                subtitle={`${counts.activePromises} invoice${counts.activePromises !== 1 ? "s" : ""} · payment committed by customer`}
                onClose={() => setPanel(null)}
              />
            )}
            {panel === "disputes" && (
              <PanelHeader
                title="Open Disputes"
                subtitle={`${counts.openDisputes} dispute${counts.openDisputes !== 1 ? "s" : ""} · pending resolution`}
                color="amber"
                onClose={() => setPanel(null)}
              />
            )}
            {panel === "needs-attention" && (
              <PanelHeader
                title="Needs Attention"
                subtitle={`${counts.needsAttention} item${counts.needsAttention !== 1 ? "s" : ""} · broken promises & open disputes`}
                color="rose"
                onClose={() => setPanel(null)}
              />
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto py-3">
              {panel === "promises" && (
                activeItems.length === 0
                  ? <EmptyPanel />
                  : <div className="space-y-1 px-3">{activeItems.map(p => <PromiseRow key={p.id} p={p} onClose={() => setPanel(null)} />)}</div>
              )}

              {panel === "disputes" && (
                openDisputeItems.length === 0
                  ? <EmptyPanel />
                  : <div className="space-y-1 px-3">{openDisputeItems.map(d => <DisputeRow key={d.id} d={d} onClose={() => setPanel(null)} />)}</div>
              )}

              {panel === "needs-attention" && (
                attentionItems.length === 0
                  ? <EmptyPanel />
                  : <div className="space-y-1 px-3">
                      {attentionItems.map(({ type, item }) =>
                        type === "dispute"
                          ? <DisputeRow key={item.id} d={item as DisputeItem} onClose={() => setPanel(null)} />
                          : <PromiseRow key={item.id} p={item as PromiseItem} onClose={() => setPanel(null)} broken />
                      )}
                    </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-stone-800 flex-shrink-0">
              <Link
                href="/responses"
                onClick={() => setPanel(null)}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-sm text-stone-300 hover:text-white transition-colors"
              >
                Open full inbox <ArrowUpRight size={13} />
              </Link>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function PanelHeader({ title, subtitle, color, onClose }: { title: string; subtitle: string; color?: "rose" | "amber"; onClose: () => void }) {
  return (
    <div className={`flex items-center justify-between px-5 py-4 border-b border-stone-800 flex-shrink-0 ${color === "rose" ? "bg-rose-500/5" : color === "amber" ? "bg-amber-500/5" : ""}`}>
      <div>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <p className="text-[11px] text-stone-500 mt-0.5">{subtitle}</p>
      </div>
      <button onClick={onClose} className="p-1.5 rounded hover:bg-stone-800 text-stone-400 hover:text-white transition-colors">
        <X size={16} />
      </button>
    </div>
  );
}

function EmptyPanel() {
  return <div className="py-12 text-center text-sm text-stone-500">Nothing to show</div>;
}

function PromiseRow({ p, onClose, broken }: { p: PromiseItem; onClose: () => void; broken?: boolean }) {
  const daysUntil = Math.ceil((new Date(p.promiseDate).getTime() - Date.now()) / 86_400_000);
  const urgencyColor = broken ? "text-rose-400" :
    daysUntil <= 0 ? "text-rose-400" : daysUntil <= 2 ? "text-amber-400" : daysUntil <= 7 ? "text-yellow-400" : "text-emerald-400";
  const dueLine = broken ? `${Math.abs(daysUntil)}d overdue` :
    daysUntil === 0 ? "Due today" : daysUntil === 1 ? "Due tomorrow" : daysUntil < 0 ? `${Math.abs(daysUntil)}d overdue` : `Due in ${daysUntil}d`;

  return (
    <Link href={`/invoices/${p.invoiceId}`} onClick={onClose}
      className="flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-stone-800/60 group transition-colors">
      <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${broken ? "bg-rose-900/40" : "bg-blue-900/40"}`}>
        <CalendarClock size={14} className={broken ? "text-rose-400" : "text-blue-400"} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-mono text-stone-400">{p.invoiceNumber}</span>
          <span className="text-[11px] text-stone-600">·</span>
          <span className="text-xs text-stone-300 truncate">{p.customerName}</span>
        </div>
        {p.projectName && <div className="text-[11px] text-stone-500 truncate mb-0.5">{p.projectName}</div>}
        <div className="flex items-center gap-2 mt-1">
          <Calendar size={10} className="text-stone-600 flex-shrink-0" />
          <span className={`text-[11px] font-medium ${urgencyColor}`}>{dueLine}</span>
          <span className="text-[11px] text-stone-600">{new Date(p.promiseDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
        </div>
        {p.note && <div className="text-[11px] text-stone-500 mt-1 italic truncate">"{p.note}"</div>}
      </div>
      <div className="text-sm font-semibold text-white tabular-nums whitespace-nowrap mt-0.5">
        {fmt.money(p.amount, p.currency)}
      </div>
    </Link>
  );
}

function DisputeRow({ d, onClose }: { d: DisputeItem; onClose: () => void }) {
  return (
    <Link href={`/invoices/${d.invoiceId}`} onClick={onClose}
      className="flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-stone-800/60 group transition-colors">
      <div className="w-8 h-8 rounded-md bg-amber-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
        <FileWarning size={14} className="text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-mono text-stone-400">{d.invoiceNumber}</span>
          <span className="text-[11px] text-stone-600">·</span>
          <span className="text-xs text-stone-300 truncate">{d.customerName}</span>
        </div>
        {d.projectName && <div className="text-[11px] text-stone-500 truncate mb-0.5">{d.projectName}</div>}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[11px] text-amber-500 font-medium">{d.category}</span>
          {d.status && <span className="text-[10px] text-stone-600">{d.status}</span>}
        </div>
        {d.reason && <div className="text-[11px] text-stone-500 mt-1 truncate">{d.reason}</div>}
        {d.assignedToName && <div className="text-[10px] text-stone-600 mt-0.5">Assigned to {d.assignedToName}</div>}
      </div>
      <div className="text-[10px] text-stone-600 whitespace-nowrap mt-1">
        {new Date(d.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
      </div>
    </Link>
  );
}
