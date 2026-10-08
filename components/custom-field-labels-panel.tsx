"use client";

import { useEffect, useState } from "react";
import { Tag } from "lucide-react";

interface DiscoveredField {
  position: number;
  name: string;
  definitionId: string;
}

/**
 * Shown on an entity workspace page for an entity whose template carries
 * "Custom Field Value (N)" columns. Tells the user what those generic,
 * positional column names actually mean for THEIR QuickBooks company before
 * they download/edit the spreadsheet — discovered by sampling real records
 * (see lib/batch/custom-fields.ts; there is no "list definitions" endpoint
 * on the REST API this app uses).
 */
export function CustomFieldLabelsPanel({ entityId, entityLabel }: { entityId: string; entityLabel: string }) {
  const [state, setState] = useState<"loading" | "disconnected" | "empty" | "ready">("loading");
  const [fields, setFields] = useState<DiscoveredField[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/batch/custom-fields?entity=${encodeURIComponent(entityId)}`)
      .then((r) => (r.ok ? r.json() : { connected: false, fields: [] }))
      .then((d) => {
        if (cancelled) return;
        setFields(d.fields || []);
        setState(!d.connected ? "disconnected" : (d.fields || []).length === 0 ? "empty" : "ready");
      })
      .catch(() => { if (!cancelled) setState("disconnected"); });
    return () => { cancelled = true; };
  }, [entityId]);

  if (state === "loading" || state === "disconnected") return null;

  return (
    <div className="mb-6 rounded-lg border border-stone-800 bg-stone-900 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Tag size={14} className="text-amber-400" />
        <span className="text-[13px] font-medium text-stone-200">Custom fields on your {entityLabel.toLowerCase()}</span>
      </div>
      {state === "empty" ? (
        <p className="text-[13px] text-stone-400 leading-relaxed">
          None found yet. The sheet's "Custom Field Value (N)" columns edit whatever QuickBooks already has, by
          position — set a value on at least one {entityLabel.toLowerCase().replace(/s$/, "")} in QuickBooks first
          (or ask Intuit to create the field on this entity), then check back here.
        </p>
      ) : (
        <>
          <p className="text-[13px] text-stone-400 mb-2">
            These are what the generic "Custom Field Value (N)" columns map to, in order, for your company:
          </p>
          <ul className="space-y-1">
            {fields.map((f) => (
              <li key={f.definitionId} className="text-[13px] text-stone-300">
                <span className="text-stone-500">Custom Field Value ({f.position})</span> → {f.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
