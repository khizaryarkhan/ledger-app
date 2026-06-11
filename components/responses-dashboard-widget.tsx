"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { MessageSquare, AlertOctagon, CalendarClock, ArrowUpRight, X, Calendar, CheckCircle2 } from "lucide-react";
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

interface Counts {
  needsAttention: number;
  openDisputes: number;
  activePromises: number;
  brokenPromises: number;
}

/**
 * Compact dashboard widget surfacing customer-response activity, linking into
 * the /responses inbox. Counts are visibility-scoped server-side.
 */
export function ResponsesDashboardWidget() {
  const [counts, setCounts]     = useState<Counts | null>(null);
  const [promises, setPromises] = useState<PromiseItem[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    fetch("/api/responses")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.counts)   setCounts(d.counts);
        if (d?.promises) setPromises(d.promises);
      })
      .catch(() => {});
  }, []);

  // Hide entirely if there's nothing to show
  if (!counts || (counts.openDisputes === 0 && counts.activePromises === 0 && counts.brokenPromises === 0)) return null;

  const activeItems = promises.filter(p => p.status === "Active" && !p.isBroken)
    .sort((a, b) => a.promiseDate.localeCompare(b.promiseDate));

  // Per-currency total for "Promise to secure"
  const byCcy: Record<string, number> = {};
  activeItems.forEach(p => { byCcy[p.currency] = (byCcy[p.currency] || 0) + (p.amount || 0); });
  const promisedSummary = Object.entries(byCcy).sort((a, b) => b[1] - a[1]).map(([c, v]) => fmt.money(v, c)).join(" · ");

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
          <Link href="/responses" className={`rounded-lg p-3 ${counts.needsAttention > 0 ? "bg-rose-900/20" : "bg-stone-800/50"} hover:ring-1 hover:ring-stone-700 transition-all`}>
            <div className="flex items-center gap-1.5 text-[11px] text-stone-500 mb-1">
              <AlertOctagon size={12} /> Needs attention
            </div>
            <div className={`text-2xl font-bold tabular-nums ${counts.needsAttention > 0 ? "text-rose-400" : "text-white"}`}>
              {counts.needsAttention}
            </div>
          </Link>

          {/* Open disputes */}
          <Link href="/responses" className="rounded-lg p-3 bg-stone-800/50 hover:ring-1 hover:ring-stone-700 transition-all">
            <div className="flex items-center gap-1.5 text-[11px] text-stone-500 mb-1">
              <AlertOctagon size={12} /> Open disputes
            </div>
            <div className="text-2xl font-bold tabular-nums text-white">{counts.openDisputes}</div>
          </Link>

          {/* Active promises — opens right panel */}
          <button
            onClick={() => setPanelOpen(true)}
            className="rounded-lg p-3 bg-stone-800/50 hover:ring-1 hover:ring-stone-700 transition-all text-left"
          >
            <div className="flex items-center gap-1.5 text-[11px] text-stone-500 mb-1">
              <CalendarClock size={12} /> Active promises
            </div>
            <div className="text-2xl font-bold tabular-nums text-blue-400">{counts.activePromises}</div>
          </button>

          {/* Promise to secure */}
          <div className="rounded-lg p-3 bg-stone-800/50">
            <div className="flex items-center gap-1.5 text-[11px] text-stone-500 mb-1">
              <CheckCircle2 size={12} /> Promise to secure
            </div>
            {counts.activePromises === 0 ? (
              <div className="text-sm text-stone-600 mt-1">—</div>
            ) : (
              <>
                <div className="text-sm font-semibold text-emerald-400 leading-snug">{promisedSummary || "—"}</div>
                <div className="text-[10px] text-stone-600 mt-0.5">
                  on {counts.activePromises} invoice{counts.activePromises !== 1 ? "s" : ""}
                </div>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* ── Active Promises slide-in panel ── */}
      {panelOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setPanelOpen(false)} />
          <div className="fixed right-0 top-0 h-full w-[440px] bg-stone-900 border-l border-stone-800 z-50 flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800 flex-shrink-0">
              <div>
                <h2 className="text-sm font-semibold text-white">Active Promises</h2>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  {counts.activePromises} invoice{counts.activePromises !== 1 ? "s" : ""} · payment committed by customer
                </p>
              </div>
              <button
                onClick={() => setPanelOpen(false)}
                className="p-1.5 rounded hover:bg-stone-800 text-stone-400 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto py-3">
              {activeItems.length === 0 ? (
                <div className="py-12 text-center text-sm text-stone-500">No active promises</div>
              ) : (
                <div className="space-y-1 px-3">
                  {activeItems.map(p => {
                    const daysUntil = Math.ceil((new Date(p.promiseDate).getTime() - Date.now()) / 86_400_000);
                    const urgencyColor =
                      daysUntil < 0  ? "text-rose-400"   :
                      daysUntil <= 2 ? "text-amber-400"  :
                      daysUntil <= 7 ? "text-yellow-400" : "text-emerald-400";
                    const dueLine =
                      daysUntil === 0  ? "Due today"                        :
                      daysUntil === 1  ? "Due tomorrow"                     :
                      daysUntil < 0   ? `${Math.abs(daysUntil)}d overdue`  :
                                        `Due in ${daysUntil}d`;
                    const dateLabel = new Date(p.promiseDate).toLocaleDateString("en-GB", {
                      day: "numeric", month: "short", year: "numeric",
                    });

                    return (
                      <Link
                        key={p.id}
                        href={`/invoices/${p.invoiceId}`}
                        onClick={() => setPanelOpen(false)}
                        className="flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-stone-800/60 group transition-colors"
                      >
                        <div className="w-8 h-8 rounded-md bg-blue-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <CalendarClock size={14} className="text-blue-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-mono text-stone-400">{p.invoiceNumber}</span>
                            <span className="text-[11px] text-stone-600">·</span>
                            <span className="text-xs text-stone-300 truncate">{p.customerName}</span>
                          </div>
                          {p.projectName && (
                            <div className="text-[11px] text-stone-500 truncate mb-0.5">{p.projectName}</div>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <Calendar size={10} className="text-stone-600 flex-shrink-0" />
                            <span className={`text-[11px] font-medium ${urgencyColor}`}>{dueLine}</span>
                            <span className="text-[11px] text-stone-600">{dateLabel}</span>
                          </div>
                          {p.note && (
                            <div className="text-[11px] text-stone-500 mt-1 italic truncate">"{p.note}"</div>
                          )}
                          {p.enteredByName && (
                            <div className="text-[10px] text-stone-600 mt-0.5">Entered by {p.enteredByName}</div>
                          )}
                        </div>
                        <div className="text-sm font-semibold text-white tabular-nums whitespace-nowrap mt-0.5">
                          {fmt.money(p.amount, p.currency)}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-stone-800 flex-shrink-0">
              <Link
                href="/responses"
                onClick={() => setPanelOpen(false)}
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
