"use client";

/**
 * Shared bulk-reclassify drawer for Customers and Projects — the two screens
 * had near-identical ~75-line ReclassifyModal implementations (same rep/
 * region/country selects, same Drawer usage), differing only in the target
 * field names and which reclassify function got called. Parameterized by
 * entity type so both pages call the one component.
 */

import { useState, useEffect } from "react";
import { useData } from "@/components/data-provider";
import { Button } from "@/components/ui";
import { Drawer, t } from "@/components/form-kit";

export type ReclassifyEntityType = "customer" | "project";

type AssignableRep = { id: string; name: string; tier: string };

export function ReclassifyDrawer({ entityType, ids, onClose }: {
  entityType: ReclassifyEntityType;
  ids: string[];
  onClose: () => void;
}) {
  const { regions, countries, reclassifyCustomers, reclassifyProjects } = useData() as any;
  const reclassify = entityType === "customer" ? reclassifyCustomers : reclassifyProjects;
  const noun = entityType === "customer" ? "customer" : "project";

  const [repId, setRepId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [countryId, setCountryId] = useState("");
  const [saving, setSaving] = useState(false);

  // Always fetch fresh reps when the drawer opens so newly-created users appear immediately
  const [freshReps, setFreshReps] = useState<AssignableRep[]>([]);
  useEffect(() => {
    fetch("/api/org/assignable-reps").then(r => r.json()).then(setFreshReps).catch(() => {});
  }, []);

  const regularReps = freshReps.filter(r => r.tier !== "ed" && r.tier !== "rd");
  const edRms = freshReps.filter(r => r.tier === "ed" || r.tier === "rd");

  const handleApply = async () => {
    if (!repId && !regionId && !countryId) return;
    setSaving(true);
    try {
      const repVal = repId === "null" ? null : repId || undefined;
      const regVal = regionId === "null" ? null : regionId || undefined;
      const ctyVal = countryId === "null" ? null : countryId || undefined;
      await reclassify(ids, repVal, regVal, ctyVal);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Drawer
      onClose={onClose}
      title={`Reclassify ${noun}s`}
      subtitle={<>Make changes to all <strong className="text-stone-300">{ids.length}</strong> selected {noun}{ids.length > 1 ? "s" : ""}.</>}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button onClick={handleApply} disabled={saving || (!repId && !regionId && !countryId)}>
            {saving ? "Applying…" : "Apply"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label className={`${t.label} block mb-1`}>
            {entityType === "project" ? "Change Rep / ED/RM to" : "Change Rep to"}
          </label>
          <select value={repId} onChange={e => setRepId(e.target.value)}
            className="w-full h-9 px-3 text-[13px] rounded-md border border-stone-700 bg-stone-800 text-stone-300 focus:border-emerald-500 focus:outline-none">
            <option value="">— No change —</option>
            <option value="null">Unassign{entityType === "customer" ? " rep" : ""}</option>
            {entityType === "project" ? (
              <>
                {regularReps.map(r => <option key={r.id} value={r.id}>{r.name} (PM)</option>)}
                {edRms.map(r => <option key={r.id} value={r.id}>{r.name} (ED/RM)</option>)}
              </>
            ) : (
              freshReps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)
            )}
          </select>
        </div>
        <div>
          <label className={`${t.label} block mb-1`}>Change Region to</label>
          <select value={regionId} onChange={e => setRegionId(e.target.value)}
            className="w-full h-9 px-3 text-[13px] rounded-md border border-stone-700 bg-stone-800 text-stone-300 focus:border-emerald-500 focus:outline-none">
            <option value="">— No change —</option>
            <option value="null">Unassign region</option>
            {regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div>
          <label className={`${t.label} block mb-1`}>Change Country to</label>
          <select value={countryId} onChange={e => setCountryId(e.target.value)}
            className="w-full h-9 px-3 text-[13px] rounded-md border border-stone-700 bg-stone-800 text-stone-300 focus:border-emerald-500 focus:outline-none">
            <option value="">— No change —</option>
            <option value="null">Unassign country</option>
            {(countries ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
    </Drawer>
  );
}
