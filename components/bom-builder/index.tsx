"use client";

/**
 * BOM Builder: create or edit a whole recipe in ONE drawer with ONE Save.
 * Picking a product copies its existing recipe; lines are typed as "name amount";
 * the footer shows the weight balance and what is still missing. Rules come from
 * lib/inventory/bom-rules.ts, the same module the save route validates with.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { kindOf } from "@/lib/inventory/item-kinds";
import { validateBom, weightBalance, type BomInput } from "@/lib/inventory/bom-rules";
import { fmt } from "@/lib/format";
import { Drawer, DrawerFooter } from "@/components/form-kit";
import { CreateNewDrawer, type CreateKind } from "@/components/create-new";
import { ProductSection, type SkuLite } from "./product-section";
import { LinesSection, type Reference, type UnknownLine } from "./lines-section";
import { OperationsSection, CostSection, type WorkCentreLite } from "./ops-cost-sections";
import type { SupplierSkuLite } from "./line-extras";
import { draftFromInput, draftToInput, emptyDraft, kgPerUnit, newLine, parseNum, type Draft, type ItemLite } from "./draft";

interface Suggest { source: { id: string; code: string | null } | null; suggestedCode: string | null; input: BomInput | null }
const getJson = (url: string) => fetch(url).then(r => r.json()).catch(() => null);

export function BomBuilderDrawer({ bomId, items, onClose, onSaved, onItemCreated }: {
  bomId: string | null;
  items: ItemLite[];
  onClose: () => void;
  onSaved: () => void;
  onItemCreated: (row: ItemLite) => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [initial, setInitial] = useState(() => JSON.stringify(emptyDraft()));
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!bomId);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [centres, setCentres] = useState<WorkCentreLite[] | null>(null);
  const [skus, setSkus] = useState<SkuLite[]>([]);
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<UnknownLine[]>([]);
  const [confirmClose, setConfirmClose] = useState(false);
  const [creating, setCreating] = useState<{ kind: CreateKind; name: string; forProduct: boolean } | null>(null);
  const [made, setMade] = useState<ItemLite[]>([]);
  const [patched, setPatched] = useState<Record<string, Partial<ItemLite>>>({});
  const [skusByItem, setSkusByItem] = useState<Record<string, SupplierSkuLite[] | undefined>>({});
  const asked = useRef<Set<string>>(new Set());

  const all = useMemo(() => [...items, ...made.filter(m => !items.some(i => i.id === m.id))].map(i => (patched[i.id] ? { ...i, ...patched[i.id] } : i)), [items, made, patched]);
  const onItemPatched = (id: string, patch: Partial<ItemLite>) => setPatched(p => ({ ...p, [id]: { ...p[id], ...patch } }));
  /** An item's supplier SKUs, fetched once when a limit or substitute first needs them. */
  function ensureSkus(itemId: string) {
    if (asked.current.has(itemId)) return;
    asked.current.add(itemId);
    getJson(`/api/inventory/items/${itemId}`).then(d => {
      const rows: any[] = Array.isArray(d?.supplierSkus) ? d.supplierSkus : [];
      setSkusByItem(m => ({ ...m, [itemId]: rows.map(r => ({ id: r.id, label: r.skuName || r.supplierProductName || r.supplierSku || "SKU", supplier: r.supplierName ?? null, code: r.supplierSku ?? null })) }));
    });
  }
  const byId = useMemo(() => new Map(all.map(i => [i.id, i])), [all]);
  const item = draft.outputItemId ? byId.get(draft.outputItemId) : undefined;
  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== initial;

  useEffect(() => { getJson("/api/production/work-centres").then(d => setCentres(Array.isArray(d) ? d.filter((c: any) => c.status === "Active") : [])); }, []);

  useEffect(() => {
    if (!bomId) return;
    getJson(`/api/inventory/boms/${bomId}/full`).then(d => {
      if (!d?.input) { setErr(d?.error || "Could not load this BOM."); setLoading(false); return; }
      const dr = draftFromInput(d.input);
      setDraft(dr); setInitial(JSON.stringify(dr)); setToken(d.updatedAt); setLoading(false);
    });
  }, [bomId]);

  useEffect(() => {
    if (!draft.outputItemId) { setSkus([]); return; }
    let live = true;
    getJson(`/api/inventory/items/${draft.outputItemId}`).then(d => { if (live) setSkus(Array.isArray(d?.skus) ? d.skus : []); });
    if (bomId) getJson(`/api/inventory/boms/suggest?itemId=${draft.outputItemId}`).then(s => { if (live) setSuggest(s); });
    return () => { live = false; };
  }, [draft.outputItemId, bomId]);

  const reference: Reference | null = useMemo(() => {
    const src = suggest?.input;
    if (!src || suggest?.source?.id === bomId || !(src.batchSize > 0)) return null;
    return { batch: src.batchSize, qtyByItem: new Map(src.inputs.map(l => [l.itemId, l.qty])) };
  }, [suggest, bomId]);

  async function pickProduct(i: ItemLite) {
    const s: Suggest | null = await getJson(`/api/inventory/boms/suggest?itemId=${i.id}`);
    setSuggest(s);
    if (s?.input && !bomId) {
      const dr = { ...draftFromInput(s.input), outputItemId: i.id, name: i.name, status: "Active" };
      setDraft(dr); setCopiedFrom(s.source?.code ?? "an earlier recipe");
    } else {
      setDraft(d => ({ ...d, outputItemId: i.id, name: d.name || i.name, code: d.code || (i.code ? `BOM_${i.code}` : "") }));
    }
  }
  function startBlank() { setDraft(d => ({ ...emptyDraft(), outputItemId: d.outputItemId, name: d.name, code: "" })); setCopiedFrom(null); }

  const input = draftToInput(draft, byId);
  const problems = [...(draft.outputItemId ? [] : ["Pick the product this recipe makes."]), ...validateBom(input), ...(unknown.length ? [`Sort out “${unknown[0].text}” first.`] : [])];
  const blocker = problems[0] ?? null;

  const batch = parseNum(draft.batchSize), outKg = item && kgPerUnit(item) != null && batch > 0 ? batch * (kgPerUnit(item) as number) : 0;
  const wb = weightBalance({ inputs: draft.inputs.map(l => ({ itemId: l.itemId, name: byId.get(l.itemId)?.name ?? "Item", qty: parseNum(l.qty) || 0, kgPerUnit: kgPerUnit(byId.get(l.itemId)) })), outKg, expYield: draft.expYield.trim() === "" ? null : parseNum(draft.expYield) });
  const wbText = wb.state === "ok" ? `✓ ${fmt.qty(wb.inKg)} kg in · ${fmt.qty(wb.outKg)} kg out · ${wb.keptPct}% kept`
    : wb.state === "gain" ? `Makes more than goes in: ${fmt.qty(wb.inKg)} kg in, ${fmt.qty(wb.outKg)} kg out`
    : wb.state === "loss" ? `About ${100 - (wb.keptPct ?? 0)}% goes missing: ${fmt.qty(wb.inKg)} kg in, ${fmt.qty(wb.outKg)} kg out`
    : wb.state === "incomplete" ? `Weight check skips ${wb.missing.join(", ")} (no weight in kg)`
    : item && kgPerUnit(item) == null ? "Weight check needs the product's weight per unit" : "Add amounts to check weights";
  const wbCls = wb.state === "ok" ? "text-emerald-400" : wb.state === "gain" || wb.state === "loss" ? "text-amber-400" : "text-stone-500";

  async function save() {
    if (blocker) return;
    setSaving(true); setErr(null);
    const r = await fetch(bomId ? `/api/inventory/boms/${bomId}/full` : "/api/inventory/boms/full", {
      method: bomId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, updatedAt: token }),
    });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { setErr(Array.isArray(d?.errors) ? d.errors.join(" ") : d?.error || "Could not save."); return; }
    onSaved();
  }
  const requestClose = () => { if (dirty && !saving) setConfirmClose(true); else onClose(); };

  const footer = confirmClose ? (
    <div className="flex items-center gap-2">
      <p className="flex-1 text-[13px] text-stone-300">Discard your changes to this recipe?</p>
      <button type="button" onClick={() => setConfirmClose(false)} className="text-[13px] font-medium text-stone-300 px-3.5 py-2 rounded-lg hover:bg-stone-800">Keep editing</button>
      <button type="button" onClick={onClose} className="text-[13px] font-semibold bg-rose-600 text-white rounded-lg px-4 py-2 hover:bg-rose-500">Discard</button>
    </div>
  ) : (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-[12px]"><span className={wbCls}>{wbText}</span><span className="flex-1" />{blocker ? <span className="text-stone-400">{blocker}</span> : <span className="text-emerald-400 font-semibold">Ready to save</span>}</div>
      <DrawerFooter saving={saving} onClose={requestClose} onSave={save} saveLabel="Save recipe" err={err} saveDisabled={!!blocker || loading} />
    </div>
  );

  return (
    <Drawer title={bomId ? "Edit Bill of Materials" : "New Bill of Materials"} subtitle={draft.code || undefined} size="2xl" pad={false} onClose={requestClose} footer={footer}>
      {loading ? <div className="px-5 py-10 text-center text-[13px] text-stone-500">Loading…</div> : (
        <>
          <ProductSection draft={draft} set={set} items={all} item={item} skus={skus} onPickProduct={pickProduct} locked={!!bomId}
            onCreateItem={name => setCreating({ kind: "item", name, forProduct: true })} />
          {copiedFrom && item && (
            <div className="mx-5 mt-4 rounded-lg border border-sky-800/50 bg-sky-500/10 px-3 py-2.5 flex flex-wrap items-center gap-2 text-[12px]">
              <div className="flex-1 min-w-[200px]"><b className="text-sky-300">Started from {copiedFrom}</b><div className="text-stone-400">Copied {draft.inputs.length} ingredients, {draft.packs.length} packaging lines and {draft.ops.length} operations. Change what is different; this saves as a new BOM.</div></div>
              <button type="button" onClick={startBlank} className="font-semibold text-stone-200 border border-stone-700 rounded-lg px-2.5 py-1 hover:border-stone-500">Start blank</button>
            </div>
          )}
          {item && (
            <>
              <LinesSection draft={draft} set={set} items={all} byId={byId} reference={reference} unknown={unknown} setUnknown={setUnknown} outputItemId={draft.outputItemId} skus={skus}
                skusByItem={skusByItem} ensureSkus={ensureSkus} onItemPatched={onItemPatched}
                onCreateItem={name => setCreating({ kind: "material", name, forProduct: false })} />
              <OperationsSection draft={draft} set={set} centres={centres} />
              <CostSection draft={draft} byId={byId} centres={centres} unit={item.baseUom || ""} />
            </>
          )}
        </>
      )}
      {creating && (
        <CreateNewDrawer kind={creating.kind} onClose={() => setCreating(null)}
          onCreated={(row: any) => {
            const lite: ItemLite = { id: row.id, name: row.name, code: row.code, productType: row.productType, baseUom: row.baseUom, unitCost: row.unitCost ?? null, onHandQty: 0, invValue: 0 };
            setMade(m => [...m, lite]); onItemCreated(lite);
            if (creating.forProduct) { if (kindOf(lite.productType).producible) pickProduct(lite); }
            else setDraft(d => ({ ...d, inputs: [...d.inputs, newLine(lite.id, "")] }));
            setCreating(null);
          }} />
      )}
    </Drawer>
  );
}
