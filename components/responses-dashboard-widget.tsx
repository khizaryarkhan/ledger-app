"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { MessageSquare, AlertOctagon, CalendarClock, ArrowUpRight } from "lucide-react";

/**
 * Compact dashboard widget surfacing customer-response activity, linking into
 * the /responses inbox. Counts are visibility-scoped server-side.
 */
export function ResponsesDashboardWidget() {
  const [counts, setCounts] = useState<{ needsAttention: number; openDisputes: number; activePromises: number; brokenPromises: number } | null>(null);

  useEffect(() => {
    fetch("/api/responses")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.counts) setCounts(d.counts); })
      .catch(() => {});
  }, []);

  // Hide entirely if there's nothing to show
  if (!counts || (counts.openDisputes === 0 && counts.activePromises === 0 && counts.brokenPromises === 0)) return null;

  const tiles = [
    { label: "Needs attention", value: counts.needsAttention, icon: AlertOctagon, tone: counts.needsAttention > 0 ? "rose" : "stone" },
    { label: "Open disputes",   value: counts.openDisputes,   icon: AlertOctagon, tone: "stone" },
    { label: "Active promises", value: counts.activePromises, icon: CalendarClock, tone: "blue" },
  ];

  return (
    <Card padding="md" className="mb-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare size={15} className="text-stone-500" />
          <h3 className="text-sm font-semibold text-white">Customer Responses</h3>
        </div>
        <Link href="/responses" className="text-xs text-stone-500 hover:text-stone-200 flex items-center gap-1">Open inbox <ArrowUpRight size={12} /></Link>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {tiles.map(t => {
          const Icon = t.icon;
          const color = t.tone === "rose" ? "text-rose-400" : t.tone === "blue" ? "text-blue-400" : "text-white";
          const bg = t.tone === "rose" && t.value > 0 ? "bg-rose-900/20" : "bg-stone-800/50";
          return (
            <Link key={t.label} href="/responses" className={`rounded-lg p-3 ${bg} hover:ring-1 hover:ring-stone-700 transition-all`}>
              <div className="flex items-center gap-1.5 text-[11px] text-stone-500 mb-1">
                <Icon size={12} /> {t.label}
              </div>
              <div className={`text-2xl font-bold tabular-nums ${color}`}>{t.value}</div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
