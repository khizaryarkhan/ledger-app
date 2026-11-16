"use client";

/**
 * BOM Builder: create or edit a whole recipe in ONE drawer with ONE Save. There is no product gate:
 * the drawer opens on the form, and the product follows from the first output SKU chosen. Lines are
 * typed as "name amount"; the footer shows the weight balance and what is still missing. Rules come
 * from lib/inventory/bom-rules.ts, the same module the save route validates with.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { kindOf } from "@/lib/inventory/item-kinds";
import { validateBom, weightBalance, nextCopyCode, type BomInput } from "@/lib/inventory/bom-rules";
import { batchToBase, batchUnitError } from "@/lib/inventory/batch-unit";
import { convert, dimensionOf, uom as uomOf } from "@/lib/inventory/uom";
import { fmt } from "@/lib/format";
import { Drawer, DrawerFooter } from "@/components/form-kit";
import { CreateNewDrawer, type CreateKind } from "@/components/create-new";
import { ProductSection, type BomOption } from "./product-section";
import { OutputSection } from "./output-section";
import { LinesSection, type Reference, type UnknownLine } from "./lines-section";
import { PackagingSection } from "./packaging-section";
import { OperationsSection, CostSection, type WorkCentreLite } from "./ops-cost-sections";
import type { SupplierSkuLite } from "./line-extras";
import {
  draftFromInput, draftToInput, emptyDraft, fingerprint, kgPerUnit, newLine, parseNum, syncPackTags,
  type Draft, type ItemLite, type SkuInfo,
} from "./draft";

interface Suggest { source: { id: string; code: string | null } | null; suggestedCode: string | null; input: BomInput | null }
const getJson = (url: string) => fetch(url).then(r => r.json()).catch(() => null);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function BomBuilderDrawer({ bomId, items, onClose, onSaved, onItemCreated }: {
  bomId: string | null;
  items: ItemLite[];
  onClose: () => void;
  onSaved: () => void;
  onItemCreated: (row: ItemLite) => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [initial, setInitial] = useState(() => fingerprint(emptyDraft()));
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!bomId);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [centres, setCentres] = useState<WorkCentreLite[] | null>(null);
  const [allSkus, setAllSkus] = useState<SkuInfo[]>([]);
  const [boms, setBoms] = useState<BomOption[]>([]);
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<UnknownLine[]>([]);
  const [confirmClose, setConfirmClose] = useState(false);
  const [creating, setCreating] = useState<{ kind: CreateKind; name: string } | null>(null);
  const [made, setMade] = useState<ItemLite[]>([]);
  const [patched, setPatched] = useState<Record<string, Partial<ItemLite>>>({});
  const [skusByItem, setSkusByItem] = useState<Record<string, SupplierSkuLite[] | undefined>>({});
  const [scaleInputs, setScaleInputs] = useState(true);
  const asked = useRef<Set<string>>(new Set());
  const skuAsked = useRef<Set<string>>(new Set());
  /** The batch (in base units) the input amounts currently correspond to; null until known. */
  const committedBase = useRef<number | null>(null);

  const all = useMemo(() => [...items, ...made.filter(m => !items.some(i => i.id === m.id))].map(i => (patched[i.id] ? { ...i, ...patched[i.id] } : i)), [items, made, patched]);
  const byId = useMemo(() => new Map(all.map(i => [i.id, i])), [all]);
  const skuById = useMemo(() => new Map(allSkus.map(s => [s.id, s])), [allSkus]);
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

  const firstSku = draft.outputs.map(o => skuById.get(o.skuId)).find(Boolean);
  const outItemId = firstSku?.itemId ?? draft.outputItemId;
  const item = outItemId ? byId.get(outItemId) : undefined;
  const baseUom = item?.baseUom ?? null;
  const unit = draft.batchUom || baseUom || "";
  const batchNum = parseNum(draft.batchSize);
  const batchBase = batchNum > 0 ? batchToBase(batchNum, baseUom, unit || null) : 0;
  const unitErr = batchUnitError(baseUom, draft.batchUom || null);
  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));
  const dirty = fingerprint(draft) !== initial;
  const contentOf = (skuId: string) => {
    const typed = parseNum(draft.outputs.find(o => o.skuId === skuId)?.qty);
    return typed > 0 ? typed : skuById.get(skuId)?.content ?? 0;
  };

  useEffect(() => { getJson("/api/production/work-centres").then(d => setCentres(Array.isArray(d) ? d.filter((c: any) => c.status === "Active") : [])); }, []);
  useEffect(() => { getJson("/api/inventory/boms").then(d => setBoms(Array.isArray(d) ? d.filter((b: any) => b.id !== bomId).map((b: any) => ({ id: b.id, code: b.code, name: b.name, outputItemName: b.outputItemName })) : [])); }, [bomId]);

  // Every packaged SKU of every producible item: the output grid offers them all until one is chosen.
  useEffect(() => {
    for (const i of all) {
      if (!kindOf(i.productType).producible || skuAsked.current.has(i.id)) continue;
      skuAsked.current.add(i.id);
      getJson(`/api/inventory/items/${i.id}`).then(d => {
        const rows: any[] = Array.isArray(d?.skus) ? d.skus : [];
        if (!rows.length) return;
        setAllSkus(prev => [...prev, ...rows.filter(r => !prev.some(p => p.id === r.id)).map(r => ({ id: r.id, name: r.skuName || r.skuCode || "SKU", code: r.skuCode ?? null, itemId: i.id, content: Number(r.innerUnitPackSize) || 0 }))]);
      });
    }
  }, [all]);

  useEffect(() => {
    if (!bomId) return;
    getJson(`/api/inventory/boms/${bomId}/full`).then(d => {
      if (!d?.input) { setErr(d?.error || "Could not load this BOM."); setLoading(false); return; }
      const dr = draftFromInput(d.input);
      setDraft(dr); setInitial(fingerprint(dr)); setToken(d.updatedAt); setLoading(false);
    });
  }, [bomId]);

  useEffect(() => {
    if (!loading && bomId && committedBase.current == null && batchBase > 0) committedBase.current = batchBase;
  }, [loading, bomId, batchBase]);

  useEffect(() => {
    if (!outItemId || copiedFrom) return;
    let live = true;
    getJson(`/api/inventory/boms/suggest?itemId=${outItemId}`).then(s => { if (live) setSuggest(s); });
    return () => { live = false; };
  }, [outItemId, copiedFrom]);

  const reference: Reference | null = useMemo(() => {
    const src = suggest?.input;
    if (!src || suggest?.source?.id === bomId || !(src.batchSize > 0)) return null;
    return { batch: batchToBase(src.batchSize, baseUom, src.batchUom ?? null), qtyByItem: new Map(src.inputs.map(l => [l.itemId, l.qty])) };
  }, [suggest, bomId, baseUom]);

  /** Outputs changed: keep packaging tags in step, and let the first SKU name an unnamed BOM. */
  function setOutputs(outputs: Draft["outputs"]) {
    setDraft(d => {
      const first = outputs.map(o => skuById.get(o.skuId)).find(Boolean);
      const hadSku = d.outputs.some(o => o.skuId);
      const auto = first && !hadSku ? { name: d.name.trim() ? d.name : first.name, code: d.code.trim() ? d.code : first.code ? `BOM_${first.code}` : d.code } : {};
      return { ...d, ...auto, outputs, packs: syncPackTags(d.packs, outputs) };
    });
  }

  function onUnitChange(next: string) {
    setDraft(d => {
      const cur = d.batchUom || baseUom || "", n = parseNum(d.batchSize);
      let size = d.batchSize;
      if (cur && n > 0 && uomOf(cur) && uomOf(next) && dimensionOf(cur) === dimensionOf(next)) {
        const r = convert(n, cur, next);
        if (r.ok) size = String(round6(r.qty));
      }
      return { ...d, batchUom: next, batchSize: size };
    });
  }

  /** The batch was edited and left: scale every input amount in proportion, from the stored base amounts. */
  function onBatchCommit(size: number) {
    const newBase = batchToBase(size, baseUom, unit || null), prev = committedBase.current;
    committedBase.current = newBase;
    if (!scaleInputs || !(prev && prev > 0) || !(newBase > 0) || Math.abs(newBase - prev) < 1e-9) return;
    const ratio = newBase / prev, sc = (q: string) => { const n = parseNum(q); return Number.isFinite(n) ? String(round6(n * ratio)) : q; };
    setDraft(d => ({ ...d, inputs: d.inputs.map(l => (l.itemId ? { ...l, qty: sc(l.qty), subs: l.subs.map(s => ({ ...s, qty: sc(s.qty) })) } : l)) }));
  }

  async function startFrom(id: string) {
    const d = await getJson(`/api/inventory/boms/${id}/full`);
    if (!d?.input) { setErr(d?.error || "Could not load that BOM."); return; }
    const src = boms.find(b => b.id === id);
    const dr = { ...draftFromInput(d.input), code: nextCopyCode(src?.code || d.input.code || d.input.name, boms.map(b => b.code || "")), status: "Active" };
    const itm = dr.outputItemId ? byId.get(dr.outputItemId) : undefined;
    committedBase.current = batchToBase(parseNum(dr.batchSize), itm?.baseUom ?? null, dr.batchUom || null);
    setSuggest({ source: { id, code: src?.code ?? null }, suggestedCode: dr.code, input: d.input });
    setDraft(dr); setCopiedFrom(src?.code || src?.name || "an earlier BOM"); setErr(null);
  }
  function startBlank() { setDraft(emptyDraft()); setCopiedFrom(null); setSuggest(null); committedBase.current = null; }

  const input = draftToInput(draft, byId, skuById, outItemId);
  const untagged = draft.packs.find(p => p.itemId && !p.forSkuId && draft.outputs.some(o => o.skuId));
  const validated = validateBom({ ...input, outputs: input.outputs.map(o => ({ ...o, qty: o.qty > 0 ? o.qty : 1 })) });
  const problems = [
    ...(item ? [] : ["Pick at least one output SKU."]),
    ...(unitErr ? [unitErr] : []),
    ...(untagged ? [`Choose which SKU ${byId.get(untagged.itemId)?.name ?? "the packaging"} packs.`] : []),
    ...validated.filter(m => !(untagged && m.startsWith("A packaging line points at"))),
    ...(unknown.length ? [`Sort out “${unknown[0].text}” first.`] : []),
  ];
  const blocker = problems[0] ?? null;

  const outKg = item && kgPerUnit(item) != null && batchBase > 0 ? batchBase * (kgPerUnit(item) as number) : 0;
  const wb = weightBalance({ inputs: draft.inputs.filter(l => l.itemId).map(l => ({ itemId: l.itemId, name: byId.get(l.itemId)?.name ?? "Item", qty: parseNum(l.qty) || 0, kgPerUnit: kgPerUnit(byId.get(l.itemId)) })), outKg, expYield: draft.expYield.trim() === "" ? null : parseNum(draft.expYield) });
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
          <ProductSection draft={draft} set={set} baseUom={baseUom} unit={unit} batchBase={batchBase} boms={boms} canStartFrom={!bomId && !dirty}
            onStartFrom={startFrom} onBatchCommit={onBatchCommit} onUnitChange={onUnitChange} scaleInputs={scaleInputs} setScaleInputs={setScaleInputs} unitErr={unitErr} />
          {copiedFrom && (
            <div className="mx-5 mt-4 rounded-lg border border-sky-800/50 bg-sky-500/10 px-3 py-2.5 flex flex-wrap items-center gap-2 text-[12px]">
              <div className="flex-1 min-w-[200px]"><b className="text-sky-300">Started from {copiedFrom} · quantities checked against it</b><div className="text-stone-400">Copied {draft.inputs.filter(l => l.itemId).length} ingredients, {draft.packs.filter(p => p.itemId).length} packaging lines and {draft.ops.length} operations. Change what is different; this saves as a new BOM.</div></div>
              <button type="button" onClick={startBlank} className="font-semibold text-stone-200 border border-stone-700 rounded-lg px-2.5 py-1 hover:border-stone-500">Start blank</button>
            </div>
          )}
          <OutputSection draft={draft} skus={allSkus} itemId={outItemId} byId={byId} batchBase={batchBase} baseUom={baseUom} onChange={setOutputs} />
          <LinesSection draft={draft} set={set} items={all} byId={byId} reference={reference} unknown={unknown} setUnknown={setUnknown} outputItemId={outItemId} batchBase={batchBase}
            skusByItem={skusByItem} ensureSkus={ensureSkus} onItemPatched={onItemPatched}
            onCreateItem={name => setCreating({ kind: "material", name })} />
          <PackagingSection draft={draft} set={set} items={all} byId={byId} skuById={skuById} batchBase={batchBase} contentOf={contentOf} outputItemId={outItemId}
            onCreateItem={name => setCreating({ kind: "material", name })} />
          <OperationsSection draft={draft} set={set} centres={centres} />
          <CostSection draft={draft} byId={byId} centres={centres} unit={item?.baseUom || ""} batch={batchBase} contentOf={contentOf} />
        </>
      )}
      {creating && (
        <CreateNewDrawer kind={creating.kind} onClose={() => setCreating(null)}
          onCreated={(row: any) => {
            const lite: ItemLite = { id: row.id, name: row.name, code: row.code, productType: row.productType, baseUom: row.baseUom, unitCost: row.unitCost ?? null, onHandQty: 0, invValue: 0 };
            setMade(m => [...m, lite]); onItemCreated(lite);
            setDraft(d => ({ ...d, inputs: [...d.inputs.filter(l => l.itemId), newLine(lite.id, ""), newLine("", "")] }));
            setCreating(null);
          }} />
      )}
    </Drawer>
  );
}
