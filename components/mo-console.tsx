"use client";

/**
 * Production module — schedule & monitor Manufacturing Orders as a flat list
 * (MO #, status, SKUs, expected/actual qty, scheduled/started/manufactured).
 * Two entry points mirror how the rest of Supply Chain separates "add work"
 * from "do work": Schedule MO creates a Draft/Scheduled order; Process MO is
 * a guided drawer — Hub (ready to start / in progress) → one order at a time
 * → allocate each material's lots → complete — the same drilldown shape as
 * Receiving's "Receive stock" (hub of open POs → items → lot capture → post).
 * Row click still opens the full detail drawer (status transitions, cancel,
 * delete, void) for anything outside that guided happy path.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Workflow, Loader, Check, Trash2, AlertTriangle, CircleDot, ChevronLeft, ChevronRight, PlayCircle, Package, MapPin } from "lucide-react";
import { Field, Section, SelectField, controlInset, cell, th, Drawer, DrawerFooter, QtyUnitField } from "@/components/form-kit";
import { localToday, ymd, fmt, formatDateShort } from "@/lib/format";

const qtyFmt = (n: any) => fmt.qty(n ?? 0);

const STATUSES = ["Draft", "Scheduled", "Released", "InProgress", "Completed", "Cancelled"] as const;
const STATUS_LABEL: Record<string, string> = { Draft: "Draft", Scheduled: "Scheduled", Released: "Released", InProgress: "In Progress", Completed: "Completed", Cancelled: "Cancelled" };
// One tone per status, everywhere a status is shown — the same rule
// CLAUDE.md's stage-colour section enforces on the Collections Board: derive
// it in one place so a status can't gain or lose colour depending on which
// screen drew it.
const STATUS_TONE: Record<string, string> = {
  Draft: "border-stone-700 text-stone-400 bg-stone-800/60",
  Scheduled: "border-sky-800/50 text-sky-400 bg-sky-500/10",
  Released: "border-violet-800/50 text-violet-400 bg-violet-500/10",
  InProgress: "border-amber-800/50 text-amber-400 bg-amber-500/10",
  Completed: "border-emerald-800/50 text-emerald-400 bg-emerald-500/10",
  Cancelled: "border-rose-800/50 text-rose-400 bg-rose-500/10",
};
function StatusPill({ status }: { status: string }) {
  return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_TONE[status] ?? "border-stone-700 text-stone-400"}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function MoConsole() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [boms, setBoms] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [salesOrders, setSalesOrders] = useState<any[]>([]);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showProcess, setShowProcess] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  async function load() { setRows(await fetch(`/api/production/mos`).then(r => r.json()).catch(() => [])); }
  useEffect(() => {
    load();
    fetch(`/api/inventory/boms`).then(r => r.json()).then(r => setBoms(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/inventory/items`).then(r => r.json()).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/trade-documents/sales-orders`).then(r => r.json()).then(r => setSalesOrders(Array.isArray(r) ? r.filter((o: any) => o.status !== "Closed") : [])).catch(() => {});
  }, []);
  useEffect(() => { if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") setShowSchedule(true); }, []);

  const list = rows ?? [];
  const weekAhead = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 7); return ymd(d); }, []);
  const kpis = useMemo(() => {
    const open = list.filter(m => !["Completed", "Cancelled"].includes(m.status));
    const soon = open.filter(m => m.scheduledDate && m.scheduledDate <= weekAhead);
    const wip = list.filter(m => m.status === "InProgress");
    const month = new Date().toISOString().slice(0, 7);
    const doneThisMonth = list.filter(m => m.status === "Completed" && String(m.completedAt ?? m.updatedAt ?? "").slice(0, 7) === month);
    return { open: open.length, soon: soon.length, wip: wip.length, done: doneThisMonth.length };
  }, [list, weekAhead]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of STATUSES) c[s] = 0;
    for (const m of list) c[m.status] = (c[m.status] ?? 0) + 1;
    return c;
  }, [list]);
  const shown = statusFilter ? list.filter(m => m.status === statusFilter) : list;
  const readyToProcess = useMemo(() => list.filter(m => ["Scheduled", "Released", "InProgress"].includes(m.status)).length, [list]);

  return (
    <div className="p-6 max-w-7xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-500/15 flex items-center justify-center"><Workflow size={18} className="text-orange-400" /></div>
          <h1 className="text-[20px] font-semibold text-stone-100">Production Schedule</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
          <button onClick={() => setShowProcess(true)} disabled={readyToProcess === 0} title={readyToProcess ? "" : "Nothing is scheduled, released or in progress yet"}
            className="flex items-center gap-1.5 text-[13px] font-semibold bg-stone-100 text-stone-900 rounded-lg px-3.5 py-2 hover:bg-white disabled:opacity-40">
            <PlayCircle size={14} /> Process MO{readyToProcess ? ` (${readyToProcess})` : ""}
          </button>
          <button onClick={() => setShowSchedule(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700"><Plus size={14} /> Schedule MO</button>
        </div>
      </div>
      <p className="text-[13px] text-stone-400 mb-5 ml-12">Plan and monitor manufacturing orders. Nothing posts until an order is completed: start it, allocate the lots it uses, then complete it to consume them and produce the output.</p>

      <div className="grid grid-cols-4 gap-2 mb-3">
        {([["Open MOs", kpis.open, "text-stone-100"], ["Scheduled ≤7 days", kpis.soon, "text-sky-400"], ["In progress", kpis.wip, "text-amber-400"], ["Completed this month", kpis.done, "text-emerald-400"]] as const).map(([l, v, c]) => (
          <div key={l} className="rounded-lg border border-stone-800 bg-stone-900 p-3">
            <div className="text-[10px] uppercase tracking-wide text-stone-500">{l}</div>
            <div className={`text-[18px] font-semibold ${c}`}>{v}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5 mb-5 flex-wrap">
        <button onClick={() => setStatusFilter(null)} className={`text-[11.5px] font-medium px-2.5 py-1 rounded-full border transition-colors ${!statusFilter ? "border-stone-500 text-stone-100 bg-stone-800" : "border-stone-800 text-stone-500 hover:text-stone-300"}`}>
          All <span className={!statusFilter ? "text-stone-400" : "text-stone-600"}>{list.length}</span>
        </button>
        {STATUSES.map(s => (
          <button key={s} onClick={() => setStatusFilter(f => f === s ? null : s)}
            className={`text-[11.5px] font-medium px-2.5 py-1 rounded-full border transition-colors ${statusFilter === s ? STATUS_TONE[s] : "border-stone-800 text-stone-500 hover:text-stone-300"}`}>
            {STATUS_LABEL[s]} <span className={statusFilter === s ? "" : "text-stone-600"}>{counts[s]}</span>
          </button>
        ))}
      </div>

      {showSchedule && <ScheduleMoDrawer boms={boms} items={items} salesOrders={salesOrders} onClose={() => setShowSchedule(false)} onCreated={() => { setShowSchedule(false); load(); }} />}
      {showProcess && <ProcessMoDrawer rows={list} onClose={() => setShowProcess(false)} onChanged={load} />}
      {openId && <MoDrawer id={openId} onClose={() => setOpenId(null)} onChanged={load} />}

      <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[980px]">
            <thead>
              <tr className="border-b border-stone-800">
                <th className={th}>MO #</th>
                <th className={th}>Status</th>
                <th className={th}>SKUs</th>
                <th className={`${th} !text-right`}>Qty expected</th>
                <th className={`${th} !text-right`}>Actual qty</th>
                <th className={th}>Scheduled</th>
                <th className={th}>Started</th>
                <th className={th}>Manufactured</th>
              </tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {rows !== null && shown.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-500">
                  {list.length === 0 ? "No manufacturing orders yet — plan one with Schedule MO." : "Nothing at this status."}
                </td></tr>
              )}
              {shown.map(m => (
                <tr key={m.id} onClick={() => setOpenId(m.id)} className="border-b border-stone-800/60 hover:bg-stone-800/20 cursor-pointer">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-stone-200 whitespace-nowrap">
                    {m.moNo || m.id.slice(0, 8)}{m.priority === "High" && <span className="ml-1.5 text-[10px] text-rose-400 font-medium align-middle">HIGH</span>}
                  </td>
                  <td className="px-4 py-2.5"><StatusPill status={m.status} /></td>
                  <td className="px-4 py-2.5 text-stone-300 max-w-[220px] truncate">{m.skuLabel || m.outputItem?.name || "—"}</td>
                  <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums whitespace-nowrap">{qtyFmt(m.qty)} {m.outputItem?.baseUom || ""}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                    {m.completedBase > 0 ? <span className="text-emerald-400">{qtyFmt(m.completedBase)} {m.outputItem?.baseUom || ""}</span> : <span className="text-stone-600">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-stone-400 whitespace-nowrap">{m.scheduledDate ? fmt.shortDate(m.scheduledDate) : "—"}</td>
                  <td className="px-4 py-2.5 text-stone-400 whitespace-nowrap">{m.startedAt ? fmt.dateTime(m.startedAt) : "—"}</td>
                  <td className="px-4 py-2.5 text-stone-400 whitespace-nowrap">{m.completedAt ? fmt.dateTime(m.completedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ScheduleMoDrawer({ boms, items, salesOrders, onClose, onCreated }: { boms: any[]; items: any[]; salesOrders: any[]; onClose: () => void; onCreated: () => void }) {
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
  // A BOM with no output packs (the shape the old Build console produced,
  // before it was removed) makes the item's BASE unit: one output, one base
  // unit each. Offered rather than refused, so every existing BOM can be
  // planned as an MO.
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
    <Drawer title="Schedule a manufacturing order" onClose={onClose} footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Schedule MO" />}>
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

/* =========================================================================
 * Process MO — a guided drawer: Hub (ready to start / in progress) → one
 * order at a time → allocate each material's lots → complete. Mirrors the
 * Receiving console's "Receive stock" drilldown (hub of open POs → items →
 * lot capture → post) so the two production-facing guided flows in Supply
 * Chain feel like one system rather than two.
 * ======================================================================= */

type ProcessView = { v: "hub" } | { v: "order"; moId: string } | { v: "lot"; moId: string; itemId: string };

function ProcessMoDrawer({ rows, onClose, onChanged }: { rows: any[]; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<"start" | "inprogress">("start");
  const [view, setView] = useState<ProcessView>({ v: "hub" });
  const [list, setList] = useState<any[]>(rows);
  const [notice, setNotice] = useState("");

  async function refresh() {
    const r = await fetch(`/api/production/mos`).then(x => x.json()).catch(() => null);
    if (Array.isArray(r)) setList(r);
  }

  const readyToStart = list.filter(m => ["Scheduled", "Released"].includes(m.status));
  const inProgress = list.filter(m => m.status === "InProgress");

  function openOrder(id: string) { setNotice(""); setView({ v: "order", moId: id }); }
  function backToHub() { setNotice(""); setView({ v: "hub" }); }

  return (
    <Drawer title="Process manufacturing order" onClose={onClose} wide pad={false}>
      {view.v === "hub" && (
        <ProcessHub readyToStart={readyToStart} inProgress={inProgress} tab={tab} setTab={setTab} notice={notice} onOpen={openOrder} />
      )}
      {view.v === "order" && (
        <OrderStep moId={view.moId} onBack={backToHub}
          onOpenLot={(itemId) => setView({ v: "lot", moId: view.moId, itemId })}
          onProgressed={async (msg) => { await refresh(); onChanged(); setNotice(msg); }}
          onCompleted={async (msg) => { await refresh(); onChanged(); setNotice(msg); setView({ v: "hub" }); }}
        />
      )}
      {view.v === "lot" && (
        <LotStep moId={view.moId} itemId={view.itemId} onBack={() => setView({ v: "order", moId: view.moId })} />
      )}
    </Drawer>
  );
}

function ProcessHub({ readyToStart, inProgress, tab, setTab, notice, onOpen }: {
  readyToStart: any[]; inProgress: any[]; tab: "start" | "inprogress"; setTab: (t: "start" | "inprogress") => void;
  notice: string; onOpen: (id: string) => void;
}) {
  const list = tab === "start" ? readyToStart : inProgress;
  return (
    <>
      <div className="flex items-center gap-1 sticky top-0 z-10 bg-stone-900 px-5 pt-4 border-b border-stone-800">
        <TabButton active={tab === "start"} onClick={() => setTab("start")} label="Ready to start" count={readyToStart.length} />
        <TabButton active={tab === "inprogress"} onClick={() => setTab("inprogress")} label="In progress" count={inProgress.length} />
      </div>
      <div className="p-5">
        {notice && <div className="mb-4 text-[12.5px] text-emerald-300 bg-emerald-950/30 border border-emerald-900 rounded-lg px-3 py-2">{notice}</div>}
        {list.length === 0 && (
          <p className="text-[13px] text-stone-500 text-center py-10">
            {tab === "start" ? "Nothing is scheduled or released yet — plan one with Schedule MO." : "Nothing is in progress right now."}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          {list.map(m => (
            <button key={m.id} onClick={() => onOpen(m.id)}
              className="text-left rounded-lg border border-stone-800 bg-stone-900 hover:border-stone-700 hover:bg-stone-800/50 p-4 transition-colors">
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-[13.5px] font-semibold text-stone-100 truncate">{m.outputItem?.name || "Unknown item"}</span>
                <ChevronRight size={15} className="text-stone-600 shrink-0" />
              </div>
              <div className="flex items-center gap-1.5 text-[12px] text-stone-400 font-mono mb-1.5">
                <Workflow size={12} className="text-orange-500" /> {m.moNo || m.id.slice(0, 8)}
              </div>
              <div className="flex items-center justify-between text-[11.5px] gap-2">
                <span className="text-stone-500 truncate">{qtyFmt(m.qty)} {m.outputItem?.baseUom || ""}{m.scheduledDate ? ` · ${fmt.shortDate(m.scheduledDate)}` : ""}</span>
                <StatusPill status={m.status} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors ${active ? "border-emerald-500 text-stone-100" : "border-transparent text-stone-500 hover:text-stone-300"}`}>
      {label} {count > 0 && <span className={`ml-1 text-[11px] ${active ? "text-emerald-400" : "text-stone-600"}`}>({count})</span>}
    </button>
  );
}

/**
 * One order, one step at a time: the next lifecycle action is always the one
 * primary button in the footer — Release, then Start, then Complete once
 * every material has lots. Materials become clickable rows once the order is
 * In Progress, each opening its own LotStep, exactly as a receipt line opens
 * its own LotCapture in Receiving.
 */
function OrderStep({ moId, onBack, onOpenLot, onProgressed, onCompleted }: {
  moId: string; onBack: () => void; onOpenLot: (itemId: string) => void;
  onProgressed: (msg: string) => void; onCompleted: (msg: string) => void;
}) {
  const [d, setD] = useState<any>(null);
  const [alloc, setAlloc] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [completing, setCompleting] = useState(false);
  const [tab, setTab] = useState<"input" | "output" | "ops">("input");

  async function load() {
    const det = await fetch(`/api/production/mos/${moId}`).then(r => r.json()).catch(() => null);
    setD(det);
    // Loaded from Draft onward so a card can show its lots read-only before
    // production starts; only In Progress may change them.
    if (det?.mo && !["Completed", "Cancelled"].includes(det.mo.status)) setAlloc(await fetch(`/api/production/mos/${moId}/allocations`).then(r => r.json()).catch(() => null));
    else setAlloc(null);
  }
  useEffect(() => { load(); }, [moId]);

  const mo = d?.mo;
  const lines: any[] = d?.materials?.lines ?? [];
  const stocked = lines.filter(l => l.tracked && l.required > 0);
  const unallocated = stocked.filter(l => !(l.allocated > 0));
  const canComplete = mo?.status === "InProgress" && stocked.length > 0 && unallocated.length === 0;

  async function transition(to: string, msg: string) {
    setBusy(true); setErr("");
    const r = await fetch(`/api/production/mos/${moId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: to }) });
    setBusy(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Failed."); return; }
    await load(); onProgressed(msg);
  }
  async function allocateAll() {
    setBusy(true); setErr("");
    for (const m of alloc?.materials ?? []) {
      if (m.allocated > 0 || !m.suggestion?.length) continue;
      const r = await fetch(`/api/production/mos/${moId}/allocations`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: m.itemId, picks: m.suggestion.map((p: any) => ({ ...p, suggested: true })) }) });
      if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not allocate."); break; }
    }
    setBusy(false); await load();
  }
  function onRunPosted(res: any) {
    setCompleting(false);
    if (res?.pending) { onProgressed("This completion exceeds your org's approval threshold and has been submitted for approval — nothing has posted yet. See Approvals."); return; }
    if (res?.final) onCompleted(`Completed — ${res.runNo} posted.`);
    else { load(); onProgressed(`Partial completion ${res.runNo} posted — allocate the rest, or complete again.`); }
  }

  if (!d || !mo) return <div className="p-5"><p className="text-[13px] text-stone-500">Loading…</p></div>;

  return (
    <>
      {completing && <CompletionDrawer id={moId} d={d} alloc={alloc} onClose={() => setCompleting(false)} onDone={onRunPosted} />}
      <div className="sticky top-0 z-10 bg-stone-900 px-5 pt-4 pb-3 border-b border-stone-800">
        <button onClick={onBack} className="flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-300 mb-2"><ChevronLeft size={13} /> All orders</button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-orange-500/15 flex items-center justify-center shrink-0"><Workflow size={15} className="text-orange-400" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-stone-100 truncate">{mo.moNo} · {d.outputItem?.name ?? ""}</div>
            <div className="text-[11.5px] text-stone-500">{qtyFmt(mo.qty)} {d.outputItem?.baseUom || ""}{mo.scheduledDate ? ` · scheduled ${fmt.shortDate(mo.scheduledDate)}` : ""}</div>
          </div>
          <StatusPill status={mo.status} />
        </div>
      </div>
      <div className="p-5 space-y-4">
        <StageNote status={mo.status} />

        <MoTabs d={d} tab={tab} setTab={setTab} />
        {tab === "input" && <InputPanel d={d} alloc={alloc} busy={busy} onAllocateAll={allocateAll} onOpen={onOpenLot} />}
        {tab === "output" && <OutputPanel d={d} />}
        {tab === "ops" && <OperationsPanel d={d} />}

        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      <div className="sticky bottom-0 z-10 bg-stone-900 border-t border-stone-800 px-5 py-3 flex items-center justify-end gap-2">
        {mo.status === "Scheduled" && (
          <button onClick={() => transition("Released", "Released for production.")} disabled={busy} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700 disabled:opacity-50">
            {busy ? <Loader size={14} className="animate-spin" /> : <ChevronRight size={14} />} Release for production
          </button>
        )}
        {mo.status === "Released" && (
          <button onClick={() => transition("InProgress", "Production started.")} disabled={busy} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700 disabled:opacity-50">
            {busy ? <Loader size={14} className="animate-spin" /> : <PlayCircle size={14} />} Start production
          </button>
        )}
        {mo.status === "InProgress" && (
          <button onClick={() => setCompleting(true)} disabled={busy || !canComplete} title={canComplete ? "" : "Allocate lots for every material first"}
            className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700 disabled:opacity-50">
            <Check size={14} /> Complete production →
          </button>
        )}
      </div>
    </>
  );
}

/** Allocate one material's lots — a dedicated step, like Receiving's LotCapture. */
function LotStep({ moId, itemId, onBack }: { moId: string; itemId: string; onBack: () => void }) {
  const [d, setD] = useState<any>(null);
  const [alloc, setAlloc] = useState<any>(null);
  const [err, setErr] = useState("");

  async function load() {
    const [det, al] = await Promise.all([
      fetch(`/api/production/mos/${moId}`).then(r => r.json()).catch(() => null),
      fetch(`/api/production/mos/${moId}/allocations`).then(r => r.json()).catch(() => null),
    ]);
    setD(det); setAlloc(al);
  }
  useEffect(() => { load(); }, [moId, itemId]);

  const line = (d?.materials?.lines ?? []).find((l: any) => l.itemId === itemId);
  const m = (alloc?.materials ?? []).find((x: any) => x.itemId === itemId);

  async function save(picks: { lotId: string; qty: number; suggested?: boolean }[]) {
    setErr("");
    const r = await fetch(`/api/production/mos/${moId}/allocations`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, picks }) });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not allocate."); return false; }
    onBack();
    return true;
  }

  return (
    <>
      <div className="sticky top-0 z-10 bg-stone-900 px-5 pt-4 pb-3 border-b border-stone-800">
        <button onClick={onBack} className="flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-300 mb-2"><ChevronLeft size={13} /> Inputs</button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-orange-500/15 flex items-center justify-center shrink-0"><Package size={15} className="text-orange-400" /></div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-stone-100 truncate">{line?.name ?? "Material"}</div>
            <div className="text-[11.5px] text-stone-500">Needs {line ? qtyFmt(line.required) : "—"} {line?.baseUom || ""}</div>
          </div>
        </div>
      </div>
      <div className="p-5">
        {!d || !alloc ? <p className="text-[13px] text-stone-500">Loading…</p> : !m ? (
          <p className="text-[13px] text-rose-400">{err || "This material isn't part of the order."}</p>
        ) : (
          <LotPicker line={line} m={m} editable={d?.mo?.status === "InProgress"} onSave={save} />
        )}
        {err && <p className="text-[12px] text-rose-400 mt-2">{err}</p>}
      </div>
    </>
  );
}

/* =========================================================================
 * Detail drawer (row click) — unchanged behaviour: status transitions, void,
 * delete, and the same inline allocate-and-complete flow, for anything the
 * guided Process MO drawer above doesn't cover on its own happy path.
 * ======================================================================= */

function MoDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<any>(null);
  const [alloc, setAlloc] = useState<any>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [tab, setTab] = useState<"input" | "output" | "ops">("input");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [info, setInfo] = useState("");
  const [completing, setCompleting] = useState(false);
  async function load() {
    const det = await fetch(`/api/production/mos/${id}`).then(r => r.json()).catch(() => null);
    setD(det);
    // Lots are shown from Draft onward (read-only until In Progress), so the
    // floor can see what it will pick from before it starts.
    if (det?.mo && !["Completed", "Cancelled"].includes(det.mo.status)) setAlloc(await fetch(`/api/production/mos/${id}/allocations`).then(r => r.json()).catch(() => null));
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
  /**
   * Void the run this MO was completed by — reverses the consumed/produced
   * lots and their GL entry, then reopens the order In Progress with nothing
   * re-allocated (the same behaviour the standalone Build console used to
   * expose; that console is gone, so this is the only way to undo a
   * completion now). Reuses the DELETE route unchanged — voidProductionRun
   * doesn't care whether the run came from a build or an MO completion.
   */
  async function voidBuild() {
    if (!mo?.productionRunId) return;
    if (!confirm("Void this completion? This reverses the stock and its GL entry, and reopens the order In Progress.")) return;
    setBusy(true); setErr("");
    const r = await fetch(`/api/inventory/production/${mo.productionRunId}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not void the completion."); return; }
    await load(); onChanged();
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
      {mo.status === "Completed" && mo.productionRunId && (
        <button onClick={voidBuild} disabled={busy} className="text-[11px] font-medium text-stone-500 hover:text-rose-400 disabled:opacity-50">
          Built ✓ — void to undo
        </button>
      )}
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
            <StatusPill status={mo.status} />
            <span>{qtyFmt(mo.qty)} {d.outputItem?.baseUom || ""}</span>
            {mo.scheduledDate && <span>· scheduled {mo.scheduledDate}</span>}
            {mo.priority === "High" && <span className="text-rose-400">· HIGH</span>}
          </div>

          <StageNote status={mo.status} />

          <MoTabs d={d} tab={tab} setTab={setTab} />

          {tab === "input" && (openItem && lines.some((l: any) => l.itemId === openItem) && alloc?.materials?.some((x: any) => x.itemId === openItem)
            ? <LotPicker key={openItem} line={lines.find((l: any) => l.itemId === openItem)} m={alloc.materials.find((x: any) => x.itemId === openItem)}
                editable={mo.status === "InProgress"} onBack={() => setOpenItem(null)}
                onSave={async picks => { const ok = await saveAlloc(openItem, picks); if (ok) setOpenItem(null); return ok; }} />
            : <InputPanel d={d} alloc={alloc} busy={busy} onAllocateAll={allocateAll} onOpen={setOpenItem} />)}

          {tab === "output" && <OutputPanel d={d} />}

          {tab === "ops" && <OperationsPanel d={d} />}

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

/* =========================================================================
 * Order tabs — Input / Output / Operations. Shared by the guided Process MO
 * drawer and the row-click detail drawer, so the two can't drift into
 * showing an order differently.
 * ======================================================================= */

type MoTab = "input" | "output" | "ops";

function MoTabs({ d, tab, setTab }: { d: any; tab: MoTab; setTab: (t: MoTab) => void }) {
  const tabs: [MoTab, string, number][] = [
    ["input", "Input", (d?.materials?.lines ?? []).length],
    ["output", "Output", (d?.outputs ?? []).length],
    ...((d?.operations ?? []).length ? [["ops", "Operations", d.operations.length] as [MoTab, string, number]] : []),
  ];
  return (
    <div role="tablist" className="flex items-center gap-1 border-b border-stone-800">
      {tabs.map(([k, label, n]) => (
        <TabButton key={k} active={tab === k} onClick={() => setTab(k)} label={label} count={n} />
      ))}
    </div>
  );
}

/** Input: one card per material. A card opens that material's lots. */
function InputPanel({ d, alloc, busy, onAllocateAll, onOpen }: {
  d: any; alloc: any; busy: boolean; onAllocateAll: () => void; onOpen: (itemId: string) => void;
}) {
  const mo = d.mo;
  const lines: any[] = d?.materials?.lines ?? [];
  const stocked = lines.filter(l => l.tracked && l.required > 0);
  const unallocated = stocked.filter(l => !(l.allocated > 0));
  const inProgress = mo.status === "InProgress";
  return (
    <div className="space-y-4">
      {inProgress && stocked.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-stone-800 bg-stone-900/40 px-3 py-2">
          <span className="text-[12px] text-stone-400">
            {unallocated.length ? `${unallocated.length} of ${stocked.length} material${stocked.length === 1 ? "" : "s"} still need lots — open one to pick its lots.` : "Every material has lots allocated — ready to complete."}
          </span>
          {unallocated.length > 0 && (
            <button onClick={onAllocateAll} disabled={busy || !alloc} className="shrink-0 text-[12px] font-medium text-stone-200 bg-stone-800 hover:bg-stone-700 rounded-lg px-3 py-1.5 disabled:opacity-50">Allocate the rest by earliest expiry</button>
          )}
        </div>
      )}
      {(["ingredient", "packaging"] as const).map(kind => {
        const group = lines.filter(l => l.kind === kind);
        if (!group.length) return null;
        return (
          <div key={kind}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-2">{kind === "ingredient" ? "Ingredients" : "Packaging"}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {group.map(l => (
                <InputCard key={l.itemId} l={l} inProgress={inProgress}
                  onOpen={l.tracked && alloc?.materials?.some((x: any) => x.itemId === l.itemId) ? () => onOpen(l.itemId) : undefined} />
              ))}
            </div>
          </div>
        );
      })}
      {lines.length === 0 && <p className="text-[12px] text-stone-500">No materials planned (the BOM has no ingredients/packaging yet).</p>}
      {!inProgress && d.materials?.anyShort && <p className="text-[11px] text-amber-400">Some materials are short — receive or produce them before production starts; completion takes only allocated lots.</p>}
    </div>
  );
}

/** Output: what the order produces, per pack, and every completion run so far. */
function OutputPanel({ d }: { d: any }) {
  const baseUom = d.outputItem?.baseUom || "";
  return (
    <div className="space-y-4">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-2">To produce</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(d.outputs ?? []).map((o: any) => {
            const done = Number(o.completedQty) || 0;
            const pct = o.qty > 0 ? Math.min(100, (done / o.qty) * 100) : 0;
            return (
              <div key={o.id} className="rounded-lg border border-stone-800 bg-stone-900/40 p-3">
                <div className="text-[13px] font-medium text-stone-100 truncate">{o.skuName || (o.skuId ? "Pack" : `${d.outputItem?.name ?? "Output"} — base unit`)}</div>
                <div className="mt-2 text-[10px] uppercase tracking-wide text-stone-500">Expected</div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[20px] font-semibold tabular-nums text-stone-100">{qtyFmt(o.qty)}</span>
                  <span className="text-[12px] text-stone-500">{o.skuId ? "packs" : (baseUom || "units")}</span>
                </div>
                {o.skuId && <div className="text-[11px] text-stone-500 tabular-nums">= {qtyFmt(o.qty * o.unitContent)} {baseUom}</div>}
                <div className="mt-2 h-1 rounded-full bg-stone-800 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                <div className="mt-1 text-[11px] text-stone-500 tabular-nums">{done > 0 ? `${qtyFmt(done)} done` : "Nothing completed yet"}</div>
              </div>
            );
          })}
        </div>
        {(d.outputs ?? []).length === 0 && <p className="text-[12px] text-stone-500">No output planned.</p>}
        {d.materials?.baseTotal > 0 && <p className="text-[11px] text-stone-500 mt-1.5">Total base to produce: {qtyFmt(d.materials.baseTotal)} {baseUom}</p>}
      </div>
      {d.mo.expYield != null && <p className="text-[11px] text-stone-500">Expected yield {d.mo.expYield}% — loss within it stays in the product&apos;s cost; loss beyond it goes to Scrap &amp; yield loss.</p>}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-2">Completions</div>
        {(d.completions ?? []).length === 0 ? <p className="text-[12px] text-stone-500">None yet. Complete the order (or part of it) to produce stock.</p> : (
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
        )}
      </div>
    </div>
  );
}

function OperationsPanel({ d }: { d: any }) {
  if (!(d.operations ?? []).length) return null;
  return (
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
  );
}

/** One input material as a card: what the order expects, and where it stands. */
function InputCard({ l, inProgress, onOpen }: { l: any; inProgress: boolean; onOpen?: () => void }) {
  const attention = l.tracked && (inProgress ? l.coverage === "none" || l.coverage === "partial" : !l.ok);
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium text-stone-100 leading-snug">{l.name}</span>
        {onOpen && <ChevronRight size={14} className="shrink-0 mt-0.5 text-stone-600 group-hover:text-stone-300" />}
      </div>
      <div className="mt-2 text-[10px] uppercase tracking-wide text-stone-500">Expected</div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[20px] font-semibold tabular-nums text-stone-100">{qtyFmt(l.required)}</span>
        <span className="text-[12px] text-stone-500">{l.baseUom}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-stone-500 tabular-nums">{!l.tracked ? "" : inProgress ? `Allocated ${qtyFmt(l.allocated)}` : `On hand ${qtyFmt(l.onHand)}`}</span>
        <MaterialStatus l={l} inProgress={inProgress} />
      </div>
    </>
  );
  const cls = attention
    ? "group text-left rounded-lg border p-3 border-amber-800/60 bg-amber-950/10"
    : "group text-left rounded-lg border p-3 border-stone-800 bg-stone-900/40";
  return onOpen
    ? <button onClick={onOpen} className={`${cls} hover:border-stone-600 hover:bg-stone-900/80 transition-colors`}>{body}</button>
    : <div className={cls}>{body}</div>;
}

/**
 * One material's lots as cards, earliest expiry first. "Planned" is the
 * earliest-expiry share of the order's requirement; "Actual" is what will be
 * consumed at completion, counted in any unit the lot comes in (its supplier's
 * packs, our own SKU packs, or the base unit — lib/inventory/order-options.ts
 * `consumptionUnits`) and sent to the server in BASE units. It may differ from
 * the plan; the material's status says by how much.
 */
function LotPicker({ line, m, editable, onBack, onSave }: {
  line: any; m: any; editable: boolean; onBack?: () => void;
  onSave: (picks: { lotId: string; qty: number; suggested?: boolean }[]) => Promise<boolean>;
}) {
  const baseUom = line.baseUom || "";
  const unitsOf = (l: any): { label: string; perUnit: number }[] => (l.units?.length ? l.units : [{ label: `${baseUom || "unit"} — base`, perUnit: 1 }]);
  const planned = new Map<string, number>((m.suggestion ?? []).map((p: any) => [p.lotId, Number(p.qty) || 0]));
  const lots: any[] = m.lots ?? [];
  const hasMine = lots.some(l => l.mine > 0);
  const seed = (from: "current" | "suggest") => Object.fromEntries(lots.map(l => {
    const base = from === "current" && hasMine ? l.mine : (planned.get(l.lotId) ?? 0);
    return [l.lotId, { v: base > 0 ? String(base) : "", u: 0 }];
  }));
  const [rows, setRows] = useState<Record<string, { v: string; u: number }>>(() => seed("current"));
  const [saving, setSaving] = useState(false);

  const baseOf = (l: any) => { const r = rows[l.lotId]; return r ? (Number(r.v) || 0) * (unitsOf(l)[r.u]?.perUnit ?? 1) : 0; };
  const total = lots.reduce((sm, l) => sm + baseOf(l), 0);
  const over = lots.filter(l => baseOf(l) > l.available + 1e-6);
  const picks = lots.map(l => ({ lotId: l.lotId, qty: Number(baseOf(l).toFixed(6)) }))
    .filter(p => p.qty > 0)
    .map(p => ({ ...p, suggested: Math.abs((planned.get(p.lotId) ?? -1) - p.qty) < 1e-6 }));

  /** Switching unit keeps the same physical quantity — 50 kg becomes 2 bags, not 50 bags. */
  function setUnit(l: any, u: number) {
    const cur = baseOf(l), per = unitsOf(l)[u]?.perUnit ?? 1;
    setRows(r => ({ ...r, [l.lotId]: { u, v: cur > 0 ? String(Number((cur / per).toFixed(6))) : r[l.lotId]?.v ?? "" } }));
  }

  const matches = Math.abs(total - line.required) < 1e-6;
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {onBack && <button onClick={onBack} className="inline-flex items-center gap-1 text-[12px] text-stone-400 hover:text-stone-200"><ChevronLeft size={13} /> All inputs</button>}
          {onBack && <div className="mt-1 text-[15px] font-semibold text-stone-100">{line.name}</div>}
          <div className="text-[10px] uppercase tracking-wide text-stone-500">Expected</div>
          <div className="text-[18px] font-semibold tabular-nums text-stone-100">{qtyFmt(line.required)} <span className="text-[12px] font-normal text-stone-500">{baseUom}</span></div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-wide text-stone-500">Using</div>
          <div className={matches ? "text-[18px] font-semibold tabular-nums text-emerald-400" : total > 0 ? "text-[18px] font-semibold tabular-nums text-amber-400" : "text-[18px] font-semibold tabular-nums text-stone-300"}>
            {qtyFmt(total)} <span className="text-[12px] font-normal text-stone-500">{baseUom}</span>
          </div>
          <div className="text-[11px] text-stone-500 tabular-nums">of {qtyFmt(m.planned)} planned</div>
        </div>
      </div>

      {!editable && <p className="text-[12px] text-stone-400 rounded-lg border border-stone-800 px-3 py-2">Start production to allocate lots. Until then these are the lots it would pick from.</p>}
      {!lots.length && <p className="text-[12px] text-amber-400">No open lots of this material. Receive or produce it first.</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {lots.map(l => {
          const units = unitsOf(l);
          const r = rows[l.lotId] ?? { v: "", u: 0 };
          const base = baseOf(l);
          const tooMuch = base > l.available + 1e-6;
          const cls = tooMuch
            ? "rounded-lg border p-3 border-rose-800/70 bg-rose-950/10"
            : base > 0 ? "rounded-lg border p-3 border-emerald-800/60 bg-emerald-950/10" : "rounded-lg border p-3 border-stone-800 bg-stone-900/40";
          return (
            <div key={l.lotId} className={cls}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-[13px] text-stone-100">{l.lotNo || "—"}</span>
                <span className="text-[11px] text-stone-500">{l.expiryDate ? `Exp ${formatDateShort(l.expiryDate)}` : "No expiry"}</span>
              </div>
              {(l.where ?? []).length > 0 && <div className="mt-0.5 flex items-center gap-1 text-[11px] text-stone-500"><MapPin size={10} /> {l.where.join(", ")}</div>}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-stone-500">Available</div>
                  <div className="text-[15px] font-medium tabular-nums text-stone-200">{qtyFmt(l.available)} <span className="text-[11px] font-normal text-stone-500">{baseUom}</span></div>
                  {l.allocatedElsewhere > 0 && <div className="text-[10px] text-stone-500">{qtyFmt(l.allocatedElsewhere)} held by other orders</div>}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-stone-500">Planned</div>
                  <div className="text-[15px] font-medium tabular-nums text-stone-200">
                    {planned.get(l.lotId) ? <>{qtyFmt(planned.get(l.lotId))} <span className="text-[11px] font-normal text-stone-500">{baseUom}</span></> : "—"}
                  </div>
                </div>
              </div>
              <div className="mt-2.5">
                <div className="text-[10px] uppercase tracking-wide text-stone-500 mb-1">Actual</div>
                <QtyUnitField variant="cell" qtyWidth="w-24" qty={r.v} disabled={!editable}
                  onQty={v => setRows(x => ({ ...x, [l.lotId]: { ...r, v } }))}
                  unit={String(r.u)} onUnit={u => setUnit(l, Number(u))} unitPlaceholder={null}
                  options={units.map((u, i) => ({ value: String(i), label: u.label }))}
                  qtyLabel={`Quantity used from lot ${l.lotNo ?? ""}`} unitLabel="Counted in" />
                {r.u > 0 && base > 0 && <div className="mt-1 text-[11px] text-stone-500 tabular-nums">= {qtyFmt(base)} {baseUom}</div>}
                {tooMuch && <div className="mt-1 text-[11px] text-rose-400">Only {qtyFmt(l.available)} {baseUom} available in this lot.</div>}
              </div>
            </div>
          );
        })}
      </div>

      {editable && lots.length > 0 && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={() => setRows(seed("suggest"))} className="text-[12px] text-stone-400 hover:text-stone-200 px-2 py-1">Suggest by earliest expiry</button>
          <button disabled={saving || over.length > 0} onClick={async () => { setSaving(true); await onSave(picks); setSaving(false); }}
            className="text-[12px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-1.5 hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "Saving…" : picks.length ? `Allocate ${qtyFmt(total)} ${baseUom}` : "Release"}
          </button>
        </div>
      )}
    </div>
  );
}
