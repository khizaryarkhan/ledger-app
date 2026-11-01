"use client";

/**
 * Small "Assigned resources" panel for a Project/MO/Job Work detail page —
 * reads the Resource Management module's assignments for this one document.
 * Renders nothing when the org doesn't have the module enabled, mirroring
 * how other module-gated UI (Job Work nav, Reporting groups) checks
 * orgSettings.enabledModules rather than assuming every org has it.
 */

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { useData } from "@/components/data-provider";
import { fmt } from "@/lib/format";

const ASSIGNABLE_LABEL: Record<string, string> = { project: "Project", manufacturing_order: "Manufacturing Order", job_work_order: "Job Work Order" };

export function AssignedResourcesPanel({ assignableType, assignableId }: { assignableType: "project" | "manufacturing_order" | "job_work_order"; assignableId: string }) {
  const { orgSettings } = useData() as any;
  const enabled = Array.isArray(orgSettings?.enabledModules) && orgSettings.enabledModules.includes("resources");
  const [rows, setRows] = useState<any[] | null>(null);

  useEffect(() => {
    if (!enabled || !assignableId) return;
    fetch(`/api/resources/assignments?assignableType=${assignableType}&assignableId=${assignableId}`)
      .then(r => r.json()).then(d => setRows(Array.isArray(d) ? d : [])).catch(() => setRows([]));
  }, [enabled, assignableType, assignableId]);

  // Committed (approved + posted) cost booked to this document, all time.
  const [cost, setCost] = useState<{ cost: number; unratedHours: number } | null>(null);
  useEffect(() => {
    if (!enabled || !assignableId) return;
    fetch(`/api/resources/cost-report?from=0000-01-01&to=9999-12-31&groupBy=month&assignableType=${assignableType}&assignableId=${assignableId}`)
      .then(r => r.json())
      .then(d => setCost(d?.totals ? { cost: (Number(d.totals.approvedCost) || 0) + (Number(d.totals.postedCost) || 0), unratedHours: Number(d.unratedHours) || 0 } : null))
      .catch(() => setCost(null));
  }, [enabled, assignableType, assignableId]);

  if (!enabled) return null;

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900 p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock size={14} className="text-pink-400" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">Assigned resources</h3>
      </div>
      {rows === null ? (
        <p className="text-[12px] text-stone-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[12px] text-stone-500">No resources booked against this {ASSIGNABLE_LABEL[assignableType].toLowerCase()} yet — book one from the Resource Board.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map(a => (
            <div key={a.id} className="flex items-center justify-between text-[12.5px]">
              <span className="text-stone-200">{a.resource?.name ?? "—"}</span>
              <span className="text-stone-500 tabular-nums">{a.allocationPercent}% · {a.startDate}{a.endDate ? ` – ${a.endDate}` : " →"}</span>
            </div>
          ))}
        </div>
      )}
      {cost && (
        <div className="mt-3 pt-3 border-t border-stone-800 flex items-center justify-between text-[12.5px]">
          <span className="text-stone-400">Resource cost (approved + posted)</span>
          <span className="text-stone-100 tabular-nums font-medium">
            {fmt.num2(cost.cost)}
            {cost.unratedHours > 0 && <span className="ml-2 text-[11px] text-amber-400">+ {cost.unratedHours}h no rate</span>}
          </span>
        </div>
      )}
    </div>
  );
}
