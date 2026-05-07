"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { fmt, daysOverdue } from "@/lib/format";
import { Users, Briefcase, ChevronRight } from "lucide-react";

const STAGES = [
  "New", "Scheduled", "Reminder Sent", "Second Notice", "Final Notice",
  "Awaiting", "Promised", "Disputed", "Escalated", "On Hold", "Closed",
];

const STAGE_COLORS: Record<string, string> = {
  "New":           "bg-stone-100 text-stone-700",
  "Scheduled":     "bg-blue-100 text-blue-700",
  "Reminder Sent": "bg-blue-200 text-blue-800",
  "Second Notice": "bg-violet-100 text-violet-700",
  "Final Notice":  "bg-violet-200 text-violet-800",
  "Awaiting":      "bg-amber-100 text-amber-700",
  "Promised":      "bg-amber-100 text-amber-800",
  "Disputed":      "bg-rose-100 text-rose-700",
  "Escalated":     "bg-rose-200 text-rose-800",
  "On Hold":       "bg-orange-100 text-orange-700",
  "Closed":        "bg-emerald-100 text-emerald-700",
  // Backward compat — old DB values map to new display colours
  "Reminder Scheduled": "bg-blue-100 text-blue-700",
  "Awaiting Reply":     "bg-amber-100 text-amber-700",
  "Promise to Pay":     "bg-amber-100 text-amber-800",
};

// Map old stored values to new stage names so cards sort into correct columns
const STAGE_NORMALIZE: Record<string, string> = {
  "Reminder Scheduled": "Scheduled",
  "Awaiting Reply":     "Awaiting",
  "Promise to Pay":     "Promised",
};
function normalizeStage(s: string): string {
  return STAGE_NORMALIZE[s] || s;
}

const AGING_COLORS = [
  { label: "Current", color: "bg-emerald-500", key: "current" },
  { label: "1–30d", color: "bg-amber-400", key: "d30" },
  { label: "31–60d", color: "bg-orange-500", key: "d60" },
  { label: "61–90d", color: "bg-rose-500", key: "d90" },
  { label: "90+d", color: "bg-rose-700", key: "d90plus" },
];

function getAgingBuckets(invs: any[]) {
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0 };
  for (const inv of invs) {
    if (inv.paymentStatus === "Paid") continue;
    const out = inv.total - (inv.paid || 0);
    const d = daysOverdue(inv.dueDate);
    buckets.total += out;
    if (d <= 0) buckets.current += out;
    else if (d <= 30) buckets.d30 += out;
    else if (d <= 60) buckets.d60 += out;
    else if (d <= 90) buckets.d90 += out;
    else buckets.d90plus += out;
  }
  return buckets;
}

function AgingBar({ buckets }: { buckets: ReturnType<typeof getAgingBuckets> }) {
  if (buckets.total === 0) return null;
  return (
    <div className="mt-3">
      <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
        {AGING_COLORS.map(({ key, color }) => {
          const pct = buckets.total > 0 ? (buckets[key as keyof typeof buckets] as number) / buckets.total * 100 : 0;
          if (pct === 0) return null;
          return <div key={key} className={`${color} h-full`} style={{ width: `${pct}%` }} title={`${key}: ${pct.toFixed(0)}%`} />;
        })}
      </div>
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        {AGING_COLORS.map(({ key, color, label }) => {
          const val = buckets[key as keyof typeof buckets] as number;
          const pct = buckets.total > 0 ? val / buckets.total * 100 : 0;
          if (pct === 0) return null;
          return (
            <div key={key} className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 rounded-full ${color}`} />
              <span className="text-[10px] text-stone-500">{label} <span className="font-medium text-stone-700">{pct.toFixed(0)}%</span></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CollectionCard({ entity, invoices, href, updateInvoice, draggingId, setDraggingId }: any) {
  const open = invoices.filter((i: any) => i.paymentStatus !== "Paid" && normalizeStage(i.collectionStage) !== "Closed");
  const outstanding = open.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
  const buckets = getAgingBuckets(open);
  const hasOverdue = open.some((i: any) => daysOverdue(i.dueDate) > 0);

  // Dominant stage (normalized)
  const stageCounts: Record<string, number> = {};
  open.forEach((i: any) => {
    const ns = normalizeStage(i.collectionStage);
    stageCounts[ns] = (stageCounts[ns] || 0) + 1;
  });
  const dominantStage = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "New";

  return (
    <Link href={href}
      draggable
      onDragStart={() => setDraggingId(entity.id)}
      onDragEnd={() => setDraggingId(null)}
      className={`block bg-white rounded-lg ring-1 ring-stone-200 p-3.5 hover:ring-stone-300 hover:shadow-sm cursor-pointer transition-all ${draggingId === entity.id ? "opacity-40" : ""}`}>

      <div className="flex items-start justify-between mb-1">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-stone-400 font-mono mb-0.5">{entity.code}</div>
          <div className="text-sm font-semibold text-stone-900 leading-tight truncate">{entity.name}</div>
        </div>
        {hasOverdue && <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1 flex-shrink-0 ml-2" />}
      </div>

      <div className="flex items-center justify-between mt-2">
        <div className="text-base font-semibold tabular-nums text-stone-900">{fmt.money(outstanding, entity.currency)}</div>
        <div className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STAGE_COLORS[dominantStage] || STAGE_COLORS["New"]}`}>
          {dominantStage}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2 text-[11px] text-stone-500">
        <span>{open.length} open invoice{open.length !== 1 ? "s" : ""}</span>
        {invoices.length > open.length && <span>· {invoices.length - open.length} closed</span>}
      </div>

      <AgingBar buckets={buckets} />
    </Link>
  );
}

export default function BoardPage() {
  const { invoices, customers, projects, regions, updateInvoice } = useData() as any;
  const [groupBy, setGroupBy] = useState<"customer" | "project">("customer");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingOverStage, setDraggingOverStage] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] = useState("");

  // Group entities by their dominant collection stage
  const grouped = useMemo(() => {
    const entities = groupBy === "customer" ? customers : projects;
    const map: Record<string, { entity: any; invoices: any[]; outstanding: number; stage: string }> = {};

    entities.forEach((e: any) => {
      // Get invoices for this entity
      let entityInvoices = invoices.filter((i: any) =>
        groupBy === "customer" ? i.customerId === e.id : i.projectId === e.id
      );
      if (entityInvoices.length === 0) return;

      // Region filter — scope invoices to only those in the selected region
      if (regionFilter) {
        entityInvoices = entityInvoices.filter((i: any) => {
          const cust = customers.find((c: any) => c.id === i.customerId);
          if (cust?.regionId === regionFilter) return true;
          const proj = projects.find((p: any) => p.id === i.projectId);
          return proj?.regionId === regionFilter;
        });
        if (entityInvoices.length === 0) return; // skip entity if no invoices in region
      }

      const open = entityInvoices.filter((i: any) => i.paymentStatus !== "Paid" && normalizeStage(i.collectionStage) !== "Closed");
      const outstanding = open.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
      if (outstanding === 0 && open.length === 0) return;

      const stageValues: Record<string, number> = {};
      open.forEach((i: any) => {
        const ns = normalizeStage(i.collectionStage);
        stageValues[ns] = (stageValues[ns] || 0) + (i.total - (i.paid || 0));
      });
      const stage = Object.entries(stageValues).sort((a, b) => b[1] - a[1])[0]?.[0] || "New";

      map[e.id] = { entity: e, invoices: entityInvoices, outstanding, stage };
    });

    return map;
  }, [invoices, customers, projects, groupBy, regionFilter]);

  const byStage = useMemo(() => {
    const result: Record<string, typeof grouped[string][]> = {};
    STAGES.forEach(s => result[s] = []);
    Object.values(grouped).forEach(item => {
      if (result[item.stage]) result[item.stage].push(item);
    });
    // Sort by outstanding desc within each stage
    Object.keys(result).forEach(s => result[s].sort((a, b) => b.outstanding - a.outstanding));
    return result;
  }, [grouped]);

  const stageTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    STAGES.forEach(s => {
      totals[s] = (byStage[s] || []).reduce((sum, item) => sum + item.outstanding, 0);
    });
    return totals;
  }, [byStage]);

  const totalAR = Object.values(stageTotals).reduce((s, v) => s + v, 0);

  const handleDrop = async (stage: string) => {
    if (!draggingId) return;
    setDraggingOverStage(null);
    const item = grouped[draggingId];
    if (!item || item.stage === stage) return;
    // Update all open invoices for this entity to the new stage
    const openInvs = item.invoices.filter((i: any) => i.paymentStatus !== "Paid" && i.collectionStage !== "Closed");
    await Promise.all(openInvs.map((i: any) => updateInvoice(i.id, { collectionStage: stage })));
    setDraggingId(null);
  };

  const visibleStages = stageFilter ? [stageFilter] : STAGES;

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-white flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-stone-900 tracking-tight">Collections Board</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {fmt.money(totalAR)} total AR · {Object.values(grouped).length} {groupBy === "customer" ? "customers" : "projects"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Region filter */}
          <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}
            className="h-8 px-2 pr-6 text-xs rounded-md ring-1 ring-stone-200 bg-white appearance-none"
            style={{backgroundImage:`url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 0.35rem center",backgroundSize:"12px"}}>
            <option value="">All regions</option>
            {(regions ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {/* Stage filter */}
          <select value={stageFilter || ""} onChange={(e) => setStageFilter(e.target.value || null)}
            className="h-8 px-2 pr-6 text-xs rounded-md ring-1 ring-stone-200 bg-white appearance-none"
            style={{backgroundImage:`url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 0.35rem center",backgroundSize:"12px"}}>
            <option value="">All stages</option>
            {STAGES.map(s => <option key={s} value={s}>{s} ({byStage[s]?.length || 0})</option>)}
          </select>

          {/* Group by toggle */}
          <div className="flex bg-stone-100 rounded-md p-0.5">
            <button onClick={() => setGroupBy("customer")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${groupBy === "customer" ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}>
              <Users size={12} /> Customers
            </button>
            <button onClick={() => setGroupBy("project")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${groupBy === "project" ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}>
              <Briefcase size={12} /> Projects
            </button>
          </div>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-3 p-4 h-full" style={{ minWidth: `${visibleStages.length * 280}px` }}>
          {visibleStages.map(stage => {
            const items = byStage[stage] || [];
            const stageTotal = stageTotals[stage] || 0;
            const isDragOver = draggingOverStage === stage;

            return (
              <div key={stage}
                className={`w-68 flex-shrink-0 flex flex-col rounded-xl transition-colors ${isDragOver ? "bg-stone-200" : "bg-stone-50"} ring-1 ring-stone-200`}
                style={{ width: "272px" }}
                onDragOver={(e) => { e.preventDefault(); setDraggingOverStage(stage); }}
                onDragLeave={() => setDraggingOverStage(null)}
                onDrop={() => handleDrop(stage)}>

                {/* Column header */}
                <div className="p-3 border-b border-stone-200 flex-shrink-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${STAGE_COLORS[stage]}`}>{stage}</span>
                    <span className="text-[11px] text-stone-500 font-mono">{items.length}</span>
                  </div>
                  <div className="text-sm font-semibold text-stone-700 tabular-nums">{fmt.money(stageTotal)}</div>
                  {totalAR > 0 && stageTotal > 0 && (
                    <div className="text-[10px] text-stone-400 mt-0.5">{(stageTotal / totalAR * 100).toFixed(1)}% of total AR</div>
                  )}
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-16">
                  {items.map(({ entity, invoices: entityInvoices, outstanding }) => (
                    <CollectionCard
                      key={entity.id}
                      entity={entity}
                      invoices={entityInvoices}
                      href={groupBy === "customer" ? `/customers/${entity.id}` : `/projects/${entity.id}`}
                      updateInvoice={updateInvoice}
                      draggingId={draggingId}
                      setDraggingId={setDraggingId}
                    />
                  ))}
                  {items.length === 0 && (
                    <div className={`text-xs text-stone-400 text-center py-6 rounded-lg border-2 border-dashed transition-colors ${isDragOver ? "border-stone-400 text-stone-500" : "border-stone-200"}`}>
                      {isDragOver ? "Drop here" : "No items"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="px-6 py-2 border-t border-stone-200 bg-white flex-shrink-0 flex items-center gap-6">
        <span className="text-[11px] text-stone-400 font-medium uppercase tracking-wider">Aging</span>
        {AGING_COLORS.map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded ${color}`} />
            <span className="text-[11px] text-stone-500">{label}</span>
          </div>
        ))}
        <span className="text-[11px] text-stone-400 ml-4">Drag a card to move all its open invoices to a new stage</span>
      </div>
    </div>
  );
}
