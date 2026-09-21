"use client";

/**
 * The one stock-location picker, shared by Receiving, Shipping and Build.
 *
 * Built once rather than three times on the same reasoning that put
 * `resolveLocationId` in a single module on the server: three copies of a
 * control drift, and the one that drifts is the one nobody is looking at.
 *
 * It renders NOTHING when the org has fewer than two active locations. A
 * single-site business should not be asked to choose between one option —
 * the server resolves the default anyway, so the field would be a decision
 * with no alternatives. This is the same rule the pay-link surfaces already
 * follow: hide the whole affordance rather than show a dead one.
 */

import { useEffect, useState } from "react";
import { Field, SelectField } from "@/components/form-kit";

export type StockLocation = {
  id: string; code: string; name: string; type: string;
  status: string; isDefault: boolean; onHandQty?: number;
};

let cache: StockLocation[] | null = null;
let inflight: Promise<StockLocation[]> | null = null;

/**
 * Active locations for the org, fetched once per page load.
 *
 * Cached at module scope because three drawers can mount in one session and
 * this list changes about as often as the warehouse does. `refresh()` exists
 * for the Locations screen, which is the one place that edits it.
 */
export function useStockLocations() {
  const [locations, setLocations] = useState<StockLocation[]>(cache ?? []);
  const [loaded, setLoaded] = useState(cache != null);

  useEffect(() => {
    if (cache) return;
    inflight ??= fetch("/api/inventory/locations")
      .then(r => (r.ok ? r.json() : { locations: [] }))
      .then(d => (d.locations ?? []).filter((l: StockLocation) => l.status === "Active"))
      // A failure here must not break the drawer it sits in: with no list the
      // picker hides and the server falls back to the default, which is
      // exactly the pre-locations behaviour.
      .catch(() => [] as StockLocation[]);
    let alive = true;
    inflight.then(list => {
      cache = list;
      if (alive) { setLocations(list); setLoaded(true); }
    });
    return () => { alive = false; };
  }, []);

  return { locations, loaded };
}

/** Drop the cache so the next mount refetches — call after editing locations. */
export function invalidateStockLocations() {
  cache = null;
  inflight = null;
}

/** The org's default location id, or "" when there are none yet. */
export function defaultLocationId(locations: StockLocation[]): string {
  return locations.find(l => l.isDefault)?.id ?? locations[0]?.id ?? "";
}

export function LocationField({
  label, value, onChange, locations, hint, issueOnly = false, allowAny = false, anyLabel,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  locations: StockLocation[];
  hint?: string;
  /**
   * Hide locations stock may not be issued from (Quarantine). The server
   * refuses them anyway — this stops someone picking one and only finding out
   * after they press Post.
   */
  issueOnly?: boolean;
  /** Offer a blank "anywhere" option — for issues, where FIFO may span locations. */
  allowAny?: boolean;
  anyLabel?: string;
}) {
  const options = issueOnly ? locations.filter(l => l.type !== "Quarantine") : locations;

  // One location (or none) is not a choice. Stay quiet and let the server
  // resolve the default.
  if (options.length < 2) return null;

  return (
    <Field label={label} hint={hint}>
      <SelectField inset value={value} onChange={e => onChange(e.target.value)}>
        {allowAny && <option value="">{anyLabel ?? "Anywhere (oldest stock first)"}</option>}
        {options.map(l => (
          <option key={l.id} value={l.id}>
            {l.code} · {l.name}{l.isDefault ? " (default)" : ""}
          </option>
        ))}
      </SelectField>
    </Field>
  );
}
