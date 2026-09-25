"use client";

/**
 * Production module — schedule & monitor Manufacturing Orders. A status board
 * (Draft → Scheduled → Released → In Progress → Completed) with KPIs, a New-MO
 * drawer, and an MO detail drawer showing material availability, status
 * transitions and the "Complete build" action (which runs the production build).
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Workflow, X, Loader, Check, Trash2, AlertTriangle, CircleDot } from "lucide-react";
import { Field, Section, SelectField, controlInset, cell, th, Drawer, DrawerFooter } from "@/components/form-kit";
import { localToday, ymd, fmt } from "@/lib/format";

const qtyFmt = (n: any) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 });

const COLUMNS = [
  { key: "Draft", label: "Draft", tone: "text-stone-400" },
  { key: "Scheduled", label: "Scheduled", tone: "text-sky-400" },
  { key: "Released", label: "Released", tone: "text-violet-400" },
  { key: "InProgress", label: "In Progress", tone: "text-amber-400" },
  { key: "Completed", label: "Completed", tone: "text-emerald-400" },
] as const;

export function MoConsole() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [boms, setBoms] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [salesOrders, setSalesOrders] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() { setRows(await fetch(`/api/production/mos`).then(r => r.json()).catch(() => [])); }
  useEffect(() => {
    load();
    fetch(`/api/inventory/boms`).then(r => r.json()).then(r => setBoms(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/inventory/items`).then(r => r.json()).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/trade-documents/sales-orders`).then(r => r.json()).then(r => setSalesOrders(Array.isArray(r) ? r.filter((o: any) => o.status !== "Closed") : [])).catch(() => {});
  }, []);
  useEffect(() => { if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") setShowNew(true); }, []);

  const list = rows ?? [];
  const weekAhead = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 7); return ymd(d); }, []);
  const kpis = useMemo(() => {
    const open = list.filter(m => !["Completed", "Cancelled"].includes(m.status));
    const soon = open.filter(m => m.scheduledDate && m.scheduledDate <= weekAhead);
    const wip = list.filter(m => m.status === "InProgress");
    const month = new Date().toISOString().slice(0, 7);
    const doneThisMonth = list.filter(m => m.status === "Completed" && (m.updatedAt ?? "").slice(0, 7) === month);
    return { open: open.length, soon: soon.length, wip: wip.length, done: doneThisMonth.length };
  }, [list, weekAhead]);

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-500/15 flex items-center justify-center"><Workflow size={18} className="text-orange-400" /></div>
          <h1 className="text-[20px] font-semibold text-stone-100">Production Schedule</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700"><Plus size={14} /> New MO</button>
        </div>
      </div>
      <p className="text-[13px] text-stone-400 mb-5 ml-12">Plan and monitor manufacturing orders. Nothing posts until an order is completed: start it, allocate the lots it uses, then complete it to consume them and produce the output.</p>

      <div className="grid grid-cols-4 gap-2 mb-5">
        {[["Open MOs", kpis.open, "text-stone-100"], ["Scheduled ≤7 days", kpis.soon, "text-sky-400"], ["In progress", kpis.wip, "text-amber-400"], ["Completed this month", kpis.done, "text-emerald-400"]].map(([l, v, c]) => (
          <div key={l as string} className="rounded-lg border border-stone-800 bg-stone-900 p-3">
            <div className="text-[10px] uppercase tracking-wide text-stone-500">{l}</div>
            <div className={`text-[18px] font-semibold ${c}`}>{v as number}</div>
          </div>
        ))}
      </div>

      {showNew && <NewMoDrawer boms={boms} items={items} salesOrders={salesOrders} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
      {openId && <MoDrawer id={openId} onClose={() => setOpenId(null)} onChanged={load} />}

      {rows === null ? <p className="text-[13px] text-stone-500">Loading…</p> : list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-800 p-10 text-center text-stone-500 text-[13px]">No manufacturing orders yet — plan one with New MO.</div>
      ) : (
        <div className="grid grid-cols-5 gap-3">
          {COLUMNS.map(col => {
            const cards = list.filter(m => m.status === col.key);
            return (
              <div key={col.key}>
                <div className={`text-[11px] font-semibold uppercase tracking-wide mb-2 ${col.tone}`}>{col.label} <span className="text-stone-600">{cards.length}</span></div>
                <div className="space-y-2">
                  {cards.map(m => (
                    <button key={m.id} onClick={() => setOpenId(m.id)} className="w-full text-left rounded-lg border border-stone-800 bg-stone-900 hover:border-stone-600 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] text-stone-400">{m.moNo}</span>
                        {m.priority === "High" && <span className="text-[10px] text-rose-400 font-medium">HIGH</span>}
                      </div>
                      <div className="text-[13px] font-medium text-stone-100 mt-0.5 leading-tight">{m.outputItem?.name ?? "—"}</div>
                      <div className="text-[11px] text-stone-500 mt-0.5">{qtyFmt(m.qty)} {m.outputItem?.baseUom || ""}{m.scheduledDate ? ` · ${m.scheduledDate}` : ""}</div>
                    </button>
                  ))}
                  {cards.length === 0 && <div className="text-[11px] text-stone-600 px-1">—</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewMoDrawer({ boms, items, salesOrders, onClose, onCreated }: { boms: any[]; items: any[]; salesOrders: any[]; onClose: () => void; onCreated: () => void }) {
  const [bomId, setBomId] = useState("");
  const [bom, setBom] = useState<any>(null);          // { outputItem, outputs:[{skuId, item, qty(unitContent)}] }
  const [packQty, setPackQty] = useState<Record<string, string>>({});  // skuId -> qty
  const [meta, setMeta] = useState<Record<string, string>>({ scheduledDate: localToday(), dueDate: "", priority: "Normal", notes: "", status: "Scheduled", salesOrderId: "" });
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const setM = (k: string, v: string) => setMeta(p => ({ ...p, [k]: v }));

  async function onBom(id: string) {
    setBomId(id); setBom(null); setPackQty({});
    if (!id) return;
    const d = await fetch(`/api/inventory/boms/${id}`).then(r => r.json()).catch(() => null);
    if (d?.bom) setBom(d);
  }
  const baseUom = bom?.outputItem?.baseUom || "";
  // A BOM with no output packs (built for Quick Build) makes the item's BASE
  // unit: one output, one base unit each. Offered rather than refused, so
  // every existing BOM can be planned as an MO.
  const outs = (bom?.outputs ?? []).length ? bom.outputs
    : bom ? [{ skuId: null, qty: 1, item: { name: `${bom.outputItem?.name ?? "Output"} (${baseUom || "base unit"})` }, base: true }] : [];
  const baseTotal = useMemo(() => outs.reduce((s: number, o: any) => s + (Number(packQty[String(o.skuId)]) || 0) * Number(o.qty), 0), [outs, packQty]);

  async function save() {
    if (!bomId || !bom) { setErr("Choose a BOM."); return; }
    const outputs = outs.map((o: any) => ({ skuId: o.skuId, qty: Number(packQty[String(o.skuId)]) || 0 })).filter((o: any) => o.qty > 0);
    if (!outputs.length) { setErr("Enter a quantity for at least one output pack."); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/production/mos`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bomId, outputItemId: bom.bom.outputItemId, outputs, ...meta }) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not create MO."); return; }
    onCreated();
  }

  return (
    <Drawer title="New manufacturing order" onClose={onClose} footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Create MO" />}>
      <div className="space-y-6">
        <Section title="Order">
          <Field label="Recipe (BOM)" required>
            <SelectField inset value={bomId} onChange={e => onBom(e.target.value)}>
              <option value="">Select a BOM…</option>
              {boms.map(b => <option key={b.id} value={b.id}>{b.code ? `${b.code} · ` : ""}{b.outputItemName || b.name}</option>)}
            </SelectField>
          </Field>

          {bom && (
            <Field label="Output packs — qty to produce">
              {outs.length === 0 ? <p className="text-[12px] text-amber-400">This BOM has no output — set its output item first.</p> : (
                <div className="rounded-lg border border-stone-800 divide-y divide-stone-800/60">
                  {outs.map((o: any) => (
                    <div key={String(o.skuId)} className="flex items-center gap-3 px-3 py-2 hover:bg-stone-950/40">
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] text-stone-100 truncate">{o.item?.name ?? "Pack"}</div>
                        <div className="text-[11px] text-stone-500">{o.base ? "no output packs on this BOM — produced in its base unit" : `${Number(o.qty)} ${baseUom}/pack`}</div>
                      </div>
                      <input type="number" value={packQty[String(o.skuId)] ?? ""} onChange={e => setPackQty(p => ({ ...p, [String(o.skuId)]: e.target.value }))} placeholder="0" className={`${controlInset} !h-8 w-24 text-right tabular-nums`} />
                      <span className="text-[11px] text-stone-500 w-16">{o.base ? baseUom || "units" : "packs"}</span>
                    </div>
                  ))}
                </div>
              )}
              {baseTotal > 0 && <p className="text-[11px] text-stone-400 mt-1.5">→ produces <span className="text-stone-200 font-medium">{baseTotal.toLocaleString()} {baseUom}</span> of {bom.outputItem?.name} in total.</p>}
            </Field>
          )}
        </Section>

        <Section title="Schedule">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Priority">
              <SelectField inset value={meta.priority} onChange={e => setM("priority", e.target.value)}><option>Low</option><option>Normal</option><option>High</option></SelectField>
            </Field>
            <Field label="Status">
              <SelectField inset value={meta.status} onChange={e => setM("status", e.target.value)}><option>Draft</option><option>Scheduled</option></SelectField>
            </Field>
            <Field label="Scheduled date">
              <input type="date" className={controlInset} value={meta.scheduledDate} onChange={e => setM("scheduledDate", e.target.value)} />
            </Field>
            <Field label="Due date">
              <input type="date" className={controlInset} value={meta.dueDate} onChange={e => setM("dueDate", e.target.value)} />
            </Field>
            <Field label="For Sales Order" className="col-span-2" hint="Optional — links this MO to a customer order's Production Tracker">
              <SelectField inset value={meta.salesOrderId} onChange={e => setM("salesOrderId", e.target.value)}>
                <option value="">None</option>
                {salesOrders.map((o: any) => <option key={o.id} value={o.id}>{o.docNumber} — {o.partyLabel}</option>)}
              </SelectField>
            </Field>
            <Field label="Notes" className="col-span-2">
              <textarea className={`${controlInset} !h-auto py-2`} rows={2} value={meta.notes} onChange={e => setM("notes", e.target.value)} />
            </Field>
          </div>
        </Section>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      </Drawer>
  );
}

function MoDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<any>(null);
  const [alloc, setAlloc] = useState<any>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [info, setInfo] = useState("");
  const [completing, setCompleting] = useState(false);
  async function load() {
    const det = await fetch(`/api/production/mos/${id}`).then(r => r.json()).catch(() => null);
    setD(det);
    if (det?.mo?.status === "InProgress") setAlloc(await fetch(`/api/production/mos/${id}/allocations`).then(r => r.json()).catch(() => null));
    else setAlloc(null);
  }
  useEffect(() => { load(); }, [id]);

  const mo = d?.mo;
  const NEXT: Record<string, { to: string; label: string }[]> = {
    Draft: [{ to: "Scheduled", label: "Schedule" }, { to: "Cancelled", label: "Cancel" }],
    Scheduled: [{ to: "Released", label: "Release" }, { to: "Cancelled", label: "Cancel" }],
    Released: [{ to: "InProgress", label: "Start production" }, { to: "Cancelled", label: "Cancel" }],
    InProgress: [{ to: "Released", label: "Back to released" }, { to: "Cancelled", label: "Cancel" }],
    Completed: [], Cancelled: [{ to: "Draft", label: "Reopen" }],
  };
  const lines: any[] = d?.materials?.lines ?? [];
  const stocked = lines.filter(l => l.tracked && l.required > 0);
  const unallocated = stocked.filter(l => !(l.allocated > 0));
  const canComplete = mo?.status === "InProgress" && unallocated.length === 0;

  async function transition(to: string) {
    if (to === "Cancelled" && lines.some(l => l.allocated > 0) && !confirm("Cancel this order? Its allocated lots are released back to stock.")) return;
    setBusy(true); setErr("");
    const r = await fetch(`/api/production/mos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: to }) });
    setBusy(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Failed."); return; }
    load(); onChanged();
  }
  function onCompleted(res: any) {
    setCompleting(false);
    if (res?.pending) setInfo("This completion exceeds your org's approval threshold and has been submitted for approval — nothing has posted yet. See Approvals.");
    else setInfo(res?.final ? `Completed — ${res.runNo} posted.` : `Partial completion ${res.runNo} posted. The order stays in progress.`);
    load(); onChanged();
  }
  async function del() {
    if (!confirm("Delete this MO?")) return;
    const r = await fetch(`/api/production/mos/${id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not delete."); return; }
    onChanged(); onClose();
  }
  /** Save one material's allocation. */
  async function saveAlloc(itemId: string, picks: { lotId: string; qty: number; suggested?: boolean }[]) {
    setErr("");
    const r = await fetch(`/api/production/mos/${id}/allocations`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, picks }) });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not allocate."); return false; }
    await load(); return true;
  }
  /** Allocate every material that has nothing yet, by earliest expiry. */
  async function allocateAll() {
    setBusy(true);
    for (const m of alloc?.materials ?? []) {
      if (m.allocated > 0 || !m.suggestion?.length) continue;
      const ok = await saveAlloc(m.itemId, m.suggestion.map((p: any) => ({ ...p, suggested: true })));
      if (!ok) break;
    }
    setBusy(false);
  }

  const footer = mo && (
    <div className="flex flex-wrap items-center gap-2">
      {mo.status !== "Completed" && !mo.productionRunId && (
        <button onClick={del} className="p-1.5 rounded hover:bg-stone-800 text-stone-500 hover:text-rose-400" title="Delete MO"><Trash2 size={14} /></button>
      )}
      {mo.status === "Completed" && mo.productionRunId && <span className="text-[11px] text-stone-500">Built ✓ — void from Quick Build to undo</span>}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {(NEXT[mo.status] ?? []).map(t => (
          <button key={t.to} onClick={() => transition(t.to)} disabled={busy} className="text-[12px] font-medium text-stone-200 bg-stone-800 hover:bg-stone-700 rounded-lg px-3 py-1.5 disabled:opacity-50">{t.label}</button>
        ))}
        {mo.status === "InProgress" && (
          <button onClick={() => setCompleting(true)} disabled={busy || !canComplete} title={canComplete ? "" : "Allocate lots for every material first"}
            className="flex items-center gap-1.5 text-[12px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-1.5 hover:bg-emerald-700 disabled:opacity-50">
            {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />} Complete…
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
    {completing && d && <CompletionDrawer id={id} d={d} alloc={alloc} onClose={() => setCompleting(false)} onDone={onCompleted} />}
    <Drawer title={mo ? `${mo.moNo} · ${d.outputItem?.name ?? ""}` : "Manufacturing order"} onClose={onClose} size="xl" footer={footer}>
      {!d ? <p className="text-[13px] text-stone-500">Loading…</p> : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[12px] text-stone-400">
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${mo.status === "Completed" ? "border-emerald-800/50 text-emerald-400 bg-emerald-500/10" : mo.status === "Cancelled" ? "border-stone-700 text-stone-500" : "border-sky-800/50 text-sky-400 bg-sky-500/10"}`}>{mo.status === "InProgress" ? "In Progress" : mo.status}</span>
            <span>{qtyFmt(mo.qty)} {d.outputItem?.baseUom || ""}</span>
            {mo.scheduledDate && <span>· scheduled {mo.scheduledDate}</span>}
            {mo.priority === "High" && <span className="text-rose-400">· HIGH</span>}
          </div>

          <StageNote status={mo.status} />

          {/* Output packs */}
          {(d.outputs ?? []).length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-2">Output packs</div>
              <div className="rounded-lg border border-stone-800 divide-y divide-stone-800/50">
                {d.outputs.map((o: any) => (
                  <div key={o.id} className="flex items-center justify-between px-3 py-1.5 text-[12px]">
                    <span className="text-stone-200">{o.skuName || (o.skuId ? "Pack" : `Base unit (${d.outputItem?.baseUom || "units"})`)}</span>
                    <span className="text-stone-400 tabular-nums">
                      {qtyFmt(o.qty)} packs · {qtyFmt(o.qty * o.unitContent)} {d.outputItem?.baseUom || ""}
                      {o.completedQty > 0 && <span className="text-emerald-400"> · {qtyFmt(o.completedQty)} done</span>}
                    </span>
                  </div>
                ))}
              </div>
              {d.materials?.baseTotal > 0 && <p className="text-[11px] text-stone-500 mt-1">Total base to produce: {qtyFmt(d.materials.baseTotal)} {d.outputItem?.baseUom || ""}</p>}
            </div>
          )}

          {/* Materials */}
          {mo.status === "InProgress" && stocked.length > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-stone-800 bg-stone-900/40 px-3 py-2">
              <span className="text-[12px] text-stone-400">
                {unallocated.length ? `${unallocated.length} of ${stocked.length} material${stocked.length === 1 ? "" : "s"} still need lots.` : "Every material has lots allocated — ready to complete."}
              </span>
              {unallocated.length > 0 && (
                <button onClick={allocateAll} disabled={busy || !alloc} className="text-[12px] font-medium text-stone-200 bg-stone-800 hover:bg-stone-700 rounded-lg px-3 py-1.5 disabled:opacity-50">Allocate the rest by earliest expiry</button>
              )}
            </div>
          )}
          {(["ingredient", "packaging"] as const).map(kind => {
            const rows = lines.filter((l: any) => l.kind === kind);
            if (!rows.length) return null;
            const inProgress = mo.status === "InProgress";
            return (
              <div key={kind}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-2">{kind === "ingredient" ? "Ingredients" : "Packaging"}</div>
                <div className="rounded-lg border border-stone-800 overflow-hidden">
                  <table className="w-full text-[12px]">
                    <thead><tr className="border-b border-stone-800">
                      <th className={th}>Material</th><th className={`${th} text-right`}>Planned</th>
                      <th className={`${th} text-right`}>{inProgress ? "Allocated" : "Available"}</th><th className={`${th} text-right`}>Status</th>
                    </tr></thead>
                    <tbody>
                      {rows.map((l: any) => {
                        const m = alloc?.materials?.find((x: any) => x.itemId === l.itemId);
                        const open = openItem === l.itemId;
                        return (
                          <Fragment key={l.itemId}>
                            <tr className={`border-b border-stone-800/50 ${inProgress && l.tracked ? "cursor-pointer hover:bg-stone-950/40" : ""}`} onClick={() => inProgress && l.tracked && setOpenItem(open ? null : l.itemId)}>
                              <td className="px-3 py-1.5 text-stone-200">{l.name}</td>
                              <td className="px-3 py-1.5 text-right text-stone-300 tabular-nums">{qtyFmt(l.required)} {l.baseUom}</td>
                              <td className="px-3 py-1.5 text-right text-stone-400 tabular-nums">{inProgress ? qtyFmt(l.allocated) : qtyFmt(l.onHand)}</td>
                              <td className="px-3 py-1.5 text-right"><MaterialStatus l={l} inProgress={inProgress} /></td>
                            </tr>
                            {open && m && (
                              <tr className="border-b border-stone-800/50 bg-stone-950/40">
                                <td colSpan={4} className="px-3 py-3">
                                  <LotAllocator m={m} baseUom={l.baseUom} onSave={picks => saveAlloc(l.itemId, picks)} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          {lines.length === 0 && <p className="text-[12px] text-stone-500">No materials planned (the BOM has no ingredients/packaging yet).</p>}
          {mo.status !== "InProgress" && d.materials?.anyShort && <p className="text-[11px] text-amber-400">Some materials are short — receive or produce them before production starts; completion takes only allocated lots.</p>}

          {(d.operations ?? []).length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-2">Operations · labour &amp; overhead</div>
              <div className="rounded-lg border border-stone-800 overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead><tr className="border-b border-stone-800"><th className={th}>Operation</th><th className={`${th} text-right`}>Planned hours</th><th className={`${th} text-right`}>Rate / hour</th><th className={`${th} text-right`}>Planned cost</th></tr></thead>
                  <tbody>
                    {d.operations.map((o: any) => (
                      <tr key={o.id} className="border-b border-stone-800/50">
                        <td className="px-3 py-1.5 text-stone-200">{o.name}</td>
                        <td className="px-3 py-1.5 text-right text-stone-300 tabular-nums">{qtyFmt(o.plannedHours)}</td>
                        <td className="px-3 py-1.5 text-right text-stone-400 tabular-nums">{fmt.num2(o.labourRate + o.overheadRate)}</td>
                        <td className="px-3 py-1.5 text-right text-stone-300 tabular-nums">{fmt.num2(o.plannedCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {d.mo.expYield != null && <p className="text-[11px] text-stone-500">Expected yield {d.mo.expYield}% — loss within it stays in the product's cost; loss beyond it goes to Scrap &amp; yield loss.</p>}
          {(d.completions ?? []).length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-2">Completions</div>
              <div className="rounded-lg border border-stone-800 overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead><tr className="border-b border-stone-800"><th className={th}>Run</th><th className={th}>Date</th><th className={`${th} text-right`}>Good</th><th className={`${th} text-right`}>Rejected</th><th className={`${th} text-right`}>Materials</th><th className={`${th} text-right`}>Labour + OH</th><th className={`${th} text-right`}>Scrap</th></tr></thead>
                  <tbody>
                    {d.completions.map((c: any) => (
                      <tr key={c.id} className="border-b border-stone-800/50">
                        <td className="px-3 py-1.5 font-mono text-[12px] text-stone-300">{c.runNo}</td>
                        <td className="px-3 py-1.5 text-stone-400">{c.date}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-stone-200">{qtyFmt(c.goodQty)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-stone-400">{c.rejectedQty ? qtyFmt(c.rejectedQty) : "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-stone-300">{fmt.num2(c.materialCost)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-stone-300">{fmt.num2(c.labourCost + c.overheadCost)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-stone-400">{c.scrapCost ? fmt.num2(c.scrapCost) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {mo.notes && <div className="text-[12px] text-stone-400"><span className="text-stone-500">Notes: </span>{mo.notes}</div>}
          {err && <p className="text-[12px] text-rose-400">{err}</p>}
          {info && <p className="text-[12px] text-amber-400 bg-amber-950/30 border border-amber-900 rounded-lg px-3 py-2">{info}</p>}
        </div>
      )}
    </Drawer>
    </>
  );
}

/**
 * One completion run. Everything defaults to "the rest of the order, with
 * everything allocated", so a single-run order is one click; a partial run
 * changes the good packs and the lots used. The preview is the server's own
 * costing of exactly this input, so what is confirmed is what posts.
 */
function CompletionDrawer({ id, d, alloc, onClose, onDone }: { id: string; d: any; alloc: any; onClose: () => void; onDone: (res: any) => void }) {
  const baseUom = d.outputItem?.baseUom || "";
  const [date, setDate] = useState(localToday());
  const [good, setGood] = useState<Record<string, string>>(() => Object.fromEntries((d.outputs ?? []).map((o: any) => [o.skuId, String(o.remainingQty ?? o.qty)])));
  const [rejected, setRejected] = useState("");
  // Final unless this run leaves packs unmade — or the user says otherwise.
  const [finalSet, setFinalSet] = useState<boolean | null>(null);
  const autoFinal = (d.outputs ?? []).every((o: any) => (Number(good[o.skuId]) || 0) + 1e-6 >= Number(o.remainingQty ?? o.qty));
  const final = finalSet ?? autoFinal;
  const [hours, setHours] = useState<Record<string, string>>({});
  const [use, setUse] = useState<Record<string, string>>({});       // lotId -> qty
  const [touchedUse, setTouchedUse] = useState(false);
  const [pv, setPv] = useState<any>(null);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState<string | null>(null);

  const allocated: { itemId: string; lotId: string; lotNo: string; mine: number; name: string }[] = (alloc?.materials ?? []).flatMap((m: any) =>
    (m.lots ?? []).filter((l: any) => l.mine > 0).map((l: any) => ({ itemId: m.itemId, lotId: l.lotId, lotNo: l.lotNo, mine: l.mine, name: (d.materials?.lines ?? []).find((x: any) => x.itemId === m.itemId)?.name ?? "" })));

  const body = () => ({
    date,
    outputs: (d.outputs ?? []).map((o: any) => ({ skuId: o.skuId, goodPacks: Number(good[o.skuId]) || 0 })),
    rejectedBase: Number(rejected) || 0,
    final,
    ...(Object.keys(hours).length ? { hours: Object.entries(hours).map(([operationId, h]) => ({ operationId, hours: Number(h) || 0 })) } : {}),
    // Untouched: the server's default — everything on a final run, this run's share on a partial one.
    ...(touchedUse ? { consume: allocated.map(a => ({ itemId: a.itemId, lotId: a.lotId, qty: Number(use[a.lotId]) || 0 })) } : {}),
  });

  // Live preview, debounced.
  useEffect(() => {
    const h = setTimeout(async () => {
      const r = await fetch(`/api/production/mos/${id}/complete?preview=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) { setPv(null); setErr(res?.error || "Can't preview this."); return; }
      setErr(null); setPv(res);
      if (!touchedUse) setUse(Object.fromEntries((res.consume ?? []).map((c: any) => [c.lotId, String(c.qty)])));
      if (!Object.keys(hours).length) { /* keep defaults visible below */ }
    }, 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, JSON.stringify(good), rejected, final, JSON.stringify(hours), JSON.stringify(touchedUse ? use : {})]);

  async function post() {
    setSaving(true); setErr(null);
    const r = await fetch(`/api/production/mos/${id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
    const res = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { setErr(res?.error || "Could not complete."); return; }
    onDone(res);
  }

  return (
    <Drawer title={`Complete ${d.mo.moNo ?? "order"}`} subtitle="One completion posts one entry. Leave the order open for a partial run." onClose={onClose} size="xl" elevated
      footer={<DrawerFooter saving={saving} onClose={onClose} onSave={post} saveLabel={final ? "Post and complete the order" : "Post partial completion"} err={err} saveDisabled={!pv} />}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Completion date"><input type="date" className={controlInset} value={date} onChange={e => setDate(e.target.value)} /></Field>
          <Field label={`Rejected (${baseUom || "base units"})`} hint="Product that came out unusable in this run.">
            <input type="number" min="0" step="any" className={controlInset} value={rejected} onChange={e => setRejected(e.target.value)} placeholder="0" />
          </Field>
        </div>

        <Section title="Good output this run">
          <div className="rounded-lg border border-stone-800 overflow-hidden">
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-stone-800"><th className={th}>Pack</th><th className={`${th} text-right`}>Remaining</th><th className={`${th} text-right w-32`}>Good packs</th></tr></thead>
              <tbody>
                {(d.outputs ?? []).map((o: any) => (
                  <tr key={o.skuId} className="border-b border-stone-800/50">
                    <td className="px-3 py-1.5 text-stone-200">{o.skuName || (o.skuId ? "Pack" : `Base unit (${baseUom || "units"})`)}</td>
                    <td className="px-3 py-1.5 text-right text-stone-400 tabular-nums">{qtyFmt(o.remainingQty)}</td>
                    <td className="px-3 py-1"><input type="number" min="0" step="any" className={`${cell} text-right tabular-nums`} value={good[o.skuId] ?? ""} onChange={e => setGood(g => ({ ...g, [o.skuId]: e.target.value }))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Lots used this run" desc={final ? "A final run uses everything allocated unless you change it; what's left over goes back to stock." : "Defaults to this run's share of what's allocated."}>
          <div className="rounded-lg border border-stone-800 overflow-hidden">
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-stone-800"><th className={th}>Material</th><th className={th}>Lot</th><th className={`${th} text-right`}>Allocated</th><th className={`${th} text-right w-32`}>Use</th></tr></thead>
              <tbody>
                {allocated.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-center text-stone-500">Nothing allocated.</td></tr>}
                {allocated.map(a => (
                  <tr key={a.lotId} className="border-b border-stone-800/50">
                    <td className="px-3 py-1.5 text-stone-200">{a.name}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px] text-stone-400">{a.lotNo || "—"}</td>
                    <td className="px-3 py-1.5 text-right text-stone-400 tabular-nums">{qtyFmt(a.mine)}</td>
                    <td className="px-3 py-1"><input type="number" min="0" step="any" className={`${cell} text-right tabular-nums`} value={use[a.lotId] ?? ""}
                      onChange={e => { setTouchedUse(true); setUse(u => ({ ...u, [a.lotId]: e.target.value })); }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {(pv?.operations ?? []).length > 0 && (
          <Section title="Hours this run" desc="Defaults to the planned hours in proportion to what this run made.">
            <div className="rounded-lg border border-stone-800 overflow-hidden">
              <table className="w-full text-[12px]">
                <thead><tr className="border-b border-stone-800"><th className={th}>Operation</th><th className={`${th} text-right w-32`}>Hours</th><th className={`${th} text-right`}>Labour</th><th className={`${th} text-right`}>Overhead</th></tr></thead>
                <tbody>
                  {pv.operations.map((o: any) => (
                    <tr key={o.id} className="border-b border-stone-800/50">
                      <td className="px-3 py-1.5 text-stone-200">{o.name}</td>
                      <td className="px-3 py-1"><input type="number" min="0" step="any" className={`${cell} text-right tabular-nums`} value={hours[o.id] ?? String(o.hours)} onChange={e => setHours(h => ({ ...h, [o.id]: e.target.value }))} /></td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-stone-300">{fmt.num2(o.labour)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-stone-300">{fmt.num2(o.overhead)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        <label className="flex items-start gap-2.5 rounded-lg border border-stone-700 px-3 py-2.5 cursor-pointer">
          <input type="checkbox" checked={final} onChange={e => setFinalSet(e.target.checked)} className="accent-emerald-600 mt-0.5" />
          <div>
            <div className="text-[13px] font-medium text-stone-200">This is the last run — complete the order</div>
            <p className="text-[12px] text-stone-400">Anything still allocated and not used goes back to stock. Untick to leave the order in progress for another run.</p>
          </div>
        </label>

        {pv && (
          <Section title="What will post">
            <div className="rounded-lg border border-stone-800 divide-y divide-stone-800/60 text-[12px]">
              {[["Materials", pv.materials], ["Labour", pv.labour], ["Overhead", pv.overhead]].map(([k, v]) => (
                <div key={k as string} className="flex justify-between px-3 py-1.5"><span className="text-stone-400">{k}</span><span className="tabular-nums text-stone-200">{fmt.num2(v as number)}</span></div>
              ))}
              {(pv.outputs ?? []).map((o: any) => (
                <div key={o.skuId} className="flex justify-between px-3 py-1.5">
                  <span className="text-stone-400">Into stock · {(d.outputs ?? []).find((x: any) => (x.skuId ?? "") === o.skuId)?.skuName ?? (o.skuId ? "pack" : "base unit")} · {qtyFmt(o.baseQty)} {baseUom} at {fmt.num2(o.unitCost)}</span>
                  <span className="tabular-nums text-emerald-400">{fmt.num2(o.amount)}</span>
                </div>
              ))}
              {pv.scrap > 0 && <div className="flex justify-between px-3 py-1.5"><span className="text-stone-400">Scrap &amp; yield loss · {qtyFmt(pv.abnormalBase)} {baseUom} beyond expected yield</span><span className="tabular-nums text-rose-400">{fmt.num2(pv.scrap)}</span></div>}
              {pv.normalLossBase > 0 && <div className="px-3 py-1.5 text-stone-500">{qtyFmt(pv.normalLossBase)} {baseUom} rejected within the expected yield — absorbed into the product's cost.</div>}
              <div className="flex justify-between px-3 py-1.5 font-semibold"><span className="text-stone-300">Total</span><span className="tabular-nums text-stone-100">{fmt.num2(pv.total)}</span></div>
            </div>
          </Section>
        )}
      </div>
    </Drawer>
  );
}

/** What this stage means for stock and the books — said once, where the user is. */
function StageNote({ status }: { status: string }) {
  const text: Record<string, string> = {
    Draft: "Draft — nothing is planned or reserved yet.",
    Scheduled: "Scheduled — the output shows as expected stock. No accounting entry.",
    Released: "Released — ready for the floor. Start production to allocate lots. No accounting entry.",
    InProgress: "In progress — pick the lots of each material. Allocated lots are reserved for this order and can't be used elsewhere. No accounting entry until you complete it.",
    Completed: "Completed — the allocated lots were consumed and the output produced; the ledger entry is posted.",
    Cancelled: "Cancelled — anything allocated was released back to stock.",
  };
  return <p className="text-[12px] text-stone-400 rounded-lg border border-stone-800 px-3 py-2">{text[status] ?? status}</p>;
}

function MaterialStatus({ l, inProgress }: { l: any; inProgress: boolean }) {
  if (!l.tracked) return <span className="text-stone-500">not stocked</span>;
  if (!inProgress) return l.ok
    ? <span className="text-emerald-400 inline-flex items-center gap-1"><CircleDot size={11} /> OK</span>
    : <span className="text-rose-400 inline-flex items-center gap-1"><AlertTriangle size={11} /> short {qtyFmt(l.short)}</span>;
  if (l.coverage === "none") return <span className="text-amber-400">allocate lots</span>;
  if (l.coverage === "partial") return <span className="text-amber-400">{qtyFmt(l.required - l.allocated)} less than planned</span>;
  if (l.coverage === "over") return <span className="text-sky-400">{qtyFmt(l.allocated - l.required)} more than planned</span>;
  return <span className="text-emerald-400 inline-flex items-center gap-1"><Check size={11} /> allocated</span>;
}

/**
 * One material's lots, earliest expiry first. The quantities typed are what
 * will be consumed at completion — which may differ from the plan; the status
 * says by how much.
 */
function LotAllocator({ m, baseUom, onSave }: { m: any; baseUom: string | null; onSave: (picks: { lotId: string; qty: number; suggested?: boolean }[]) => Promise<boolean> }) {
  const initial = () => {
    const mine = Object.fromEntries((m.lots ?? []).filter((l: any) => l.mine > 0).map((l: any) => [l.lotId, String(l.mine)]));
    return Object.keys(mine).length ? mine : Object.fromEntries((m.suggestion ?? []).map((p: any) => [p.lotId, String(p.qty)]));
  };
  const [qty, setQty] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const suggested = new Map((m.suggestion ?? []).map((p: any) => [p.lotId, p.qty]));
  const total = Object.values(qty).reduce((sm, v) => sm + (Number(v) || 0), 0);
  const picks = Object.entries(qty).map(([lotId, v]) => ({ lotId, qty: Number(v) || 0, suggested: suggested.get(lotId) === (Number(v) || 0) })).filter(p => p.qty > 0);

  if (!(m.lots ?? []).length) return <p className="text-[12px] text-amber-400">No open lots of this material. Receive or produce it first.</p>;
  return (
    <div className="space-y-2">
      <table className="w-full text-[12px]">
        <thead><tr>
          <th className={th}>Lot</th><th className={th}>Expiry</th><th className={th}>Where</th>
          <th className={`${th} text-right`}>Available</th><th className={`${th} text-right w-32`}>Use</th>
        </tr></thead>
        <tbody>
          {m.lots.map((l: any) => (
            <tr key={l.lotId} className="border-t border-stone-800/50">
              <td className="px-2.5 py-1 font-mono text-[12px] text-stone-300">{l.lotNo || "—"}</td>
              <td className="px-2.5 py-1 text-stone-400">{l.expiryDate || "—"}</td>
              <td className="px-2.5 py-1 text-stone-400">{(l.where ?? []).join(", ") || "—"}</td>
              <td className="px-2.5 py-1 text-right text-stone-400 tabular-nums">
                {qtyFmt(l.available)}{l.allocatedElsewhere > 0 && <span className="block text-[10px] text-stone-500">{qtyFmt(l.allocatedElsewhere)} held by other orders</span>}
              </td>
              <td className="px-2.5 py-1">
                <input type="number" min="0" step="any" className={`${cell} text-right tabular-nums`} value={qty[l.lotId] ?? ""}
                  onChange={e => setQty(q => ({ ...q, [l.lotId]: e.target.value }))} onClick={e => e.stopPropagation()} placeholder="0" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-stone-400">Using {qtyFmt(total)} {baseUom || ""} of {qtyFmt(m.planned)} planned</span>
        <div className="flex items-center gap-2">
          <button onClick={e => { e.stopPropagation(); setQty(Object.fromEntries((m.suggestion ?? []).map((p: any) => [p.lotId, String(p.qty)]))); }}
            className="text-[12px] text-stone-400 hover:text-stone-200 px-2 py-1">Suggest by earliest expiry</button>
          <button disabled={saving} onClick={async e => { e.stopPropagation(); setSaving(true); await onSave(picks); setSaving(false); }}
            className="text-[12px] font-semibold bg-emerald-600 text-white rounded-lg px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-50">{saving ? "Saving…" : picks.length ? "Allocate" : "Release"}</button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Drawer shell ----------------------------- */


