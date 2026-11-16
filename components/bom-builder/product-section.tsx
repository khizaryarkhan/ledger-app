"use client";

/**
 * The top of the drawer: optional "start from an existing BOM", BOM ID, status, name, the batch
 * (a number AND the unit it is counted in) and the expected yield. There is no product picker:
 * the product follows from the first output SKU chosen below.
 */

import { fmt } from "@/lib/format";
import { evalArithmetic } from "@/lib/calc";
import { dimensionOf } from "@/lib/inventory/uom";
import { DIMENSION_LABEL, unitGroups } from "@/lib/inventory/batch-unit";
import { CalcInput, Field, SelectField, controlInset } from "@/components/form-kit";
import type { Draft } from "./draft";

export interface BomOption { id: string; code: string | null; name: string; outputItemName?: string | null }

const GROUPS = unitGroups();

export function ProductSection({ draft, set, baseUom, unit, batchBase, boms, canStartFrom, onStartFrom, onBatchCommit, onUnitChange, scaleInputs, setScaleInputs, unitErr }: {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  /** The output item's base unit, once an output SKU is chosen. */
  baseUom: string | null;
  /** The unit the batch is shown in: the chosen one, else the base unit. */
  unit: string;
  batchBase: number;
  boms: BomOption[];
  canStartFrom: boolean;
  onStartFrom: (id: string) => void;
  onBatchCommit: (size: number) => void;
  onUnitChange: (next: string) => void;
  scaleInputs: boolean;
  setScaleInputs: (v: boolean) => void;
  unitErr: string | null;
}) {
  const baseDim = dimensionOf(baseUom);
  const dim = dimensionOf(unit);
  return (
    <section className="px-5 py-5 border-b border-stone-800 space-y-4">
      {canStartFrom && boms.length > 0 && (
        <Field label="Start from an existing BOM" hint="Optional. Copies its ingredients, packaging and operations into a new BOM.">
          <SelectField inset value="" onChange={e => e.target.value && onStartFrom(e.target.value)} aria-label="Start from an existing BOM">
            <option value="">Start blank</option>
            {boms.map(b => <option key={b.id} value={b.id}>{b.code || b.name}{b.outputItemName ? ` · ${b.outputItemName}` : ""}</option>)}
          </SelectField>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Field label="BOM ID" hint="Unique in your company. Copies suggest a -V2 style ID.">
          <input className={controlInset} value={draft.code} onChange={e => set({ code: e.target.value })} placeholder="e.g. BOM_HOB-40" />
        </Field>
        <Field label="Status">
          <SelectField inset value={draft.status} onChange={e => set({ status: e.target.value })}><option>Active</option><option>Draft</option><option>Archived</option></SelectField>
        </Field>
        <Field label="BOM name" required className="col-span-2">
          <input className={controlInset} value={draft.name} onChange={e => set({ name: e.target.value })} />
        </Field>
        <Field label="One batch makes (potential output)" required error={unitErr}
          hint={dim ? <>{DIMENSION_LABEL[dim]}{baseUom && batchBase > 0 ? <> · stored as {fmt.qty(batchBase)} {baseUom}</> : null}</> : undefined}>
          <div className="flex gap-2">
            <CalcInput className={`${controlInset} text-right tabular-nums`} value={draft.batchSize} onChange={v => set({ batchSize: v })} placeholder="e.g. 400"
              onBlur={e => { const n = evalArithmetic(e.currentTarget.value); if (n != null && n > 0) onBatchCommit(n); }}
              onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} aria-label="Batch size" />
            <div className="w-32 flex-shrink-0">
              <SelectField inset value={unit} onChange={e => onUnitChange(e.target.value)} aria-label="Batch unit">
                {!unit && <option value="">Unit</option>}
                {GROUPS.map(g => (
                  <optgroup key={g.dimension} label={g.label}>
                    {g.units.map(u => <option key={u.code} value={u.code} disabled={!!baseDim && u.dimension !== baseDim}>{u.code}</option>)}
                  </optgroup>
                ))}
              </SelectField>
            </div>
          </div>
        </Field>
        <Field label="Expected yield %" hint="Loss within it stays in the product's cost; loss beyond it goes to Scrap & yield loss. Blank = 100%.">
          <CalcInput className={`${controlInset} text-right tabular-nums`} value={draft.expYield} onChange={v => set({ expYield: v })} placeholder="e.g. 98" aria-label="Expected yield" />
        </Field>
        <label className="col-span-2 flex items-center gap-2 text-[12px] text-stone-300 cursor-pointer">
          <input type="checkbox" className="accent-blue-600" checked={scaleInputs} onChange={e => setScaleInputs(e.target.checked)} />
          Scale input amounts when the batch changes
        </label>
      </div>
    </section>
  );
}
