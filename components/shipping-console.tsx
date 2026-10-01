"use client";

/**
 * Shipping — post shipments (Dr COGS / Cr Inventory at FIFO cost) against a
 * Sales Order or ad-hoc, then create an Invoice from shipped-but-uninvoiced
 * shipments (Dr A/R / Cr Revenue). "Ship stock" is a guided drawer — hub
 * (ready to ship / in progress) → one Sales Order's lines → capture what's
 * actually shipping, in any of the item's own SKU packs or its base unit →
 * post — the same drilldown shape as Receiving's "Receive stock" (hub of
 * open POs → items → lot capture → post) and Process MO's Input/Output
 * capture (QtyUnitField + a pack-unit picker), so the three guided
 * inventory flows read as one system.
 */

import { useEffect, useMemo, useState } from "react";
import { useStockLocations, LocationField } from "@/components/location-picker";
import { useData } from "@/components/data-provider";
import { Plus, RefreshCw, Truck, Trash2, FileText, ChevronLeft, ChevronRight, Boxes, Package } from "lucide-react";
import { kindOf } from "@/lib/inventory/item-kinds";
import { fmt, localToday } from "@/lib/format";
import { QTY_EPSILON } from "@/lib/inventory/round";
import { salesOrderOptions } from "@/lib/inventory/order-options";
import { Field, Section, SelectField, controlInset, Drawer, DrawerFooter, QtyUnitField } from "@/components/form-kit";
import {
  useListView, ListPage, ListPageHeader, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  listTable, listRow, listCheckCell, listCheckbox, listMoneyCell, listNumCell, type ListColumn,
} from "@/components/list-view";

const money = fmt.num2;
const qtyFmt = (n: any) => fmt.qty(n ?? 0);

export function ShippingConsole() {
  const { orgSettings } = useData() as any;
  const ccy = orgSettings?.currency ?? "EUR";
  const [rows, setRows] = useState<any[] | null>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [invoicing, setInvoicing] = useState(false);
  const [voidErr, setVoidErr] = useState("");

  async function load() {
    const r = await fetch(`/api/inventory/shipping`).then(x => x.json()).catch(() => []);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => {
    load();
    fetch(`/api/parties/customers?native=1`).then(x => x.json()).then(r => setCustomers(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/inventory/items`).then(x => x.json()).then(r => setItems(Array.isArray(r) ? r.filter((i: any) => kindOf(i.productType).tracked) : [])).catch(() => {});
  }, []);
  useEffect(() => { if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") setShowNew(true); }, []);

  async function voidRow(id: string, no: string) {
    if (!confirm(`Void shipment ${no}? This puts the stock back and reverses its GL entry.`)) return;
    setVoidErr("");
    const r = await fetch(`/api/inventory/shipping/${id}`, { method: "DELETE" });
    if (!r.ok) { setVoidErr((await r.json().catch(() => ({})))?.error || "Could not void shipment."); return; }
    load();
  }

  const listRows = rows ?? [];
  const SHIP_COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "shipmentNo", label: "Shipment #", sort: r => r.shipmentNo, filter: { kind: "text", value: r => r.shipmentNo } },
    { key: "customer", label: "Customer", sort: r => r.customerLabel, filter: { kind: "multi", value: r => r.customerLabel } },
    { key: "date", label: "Date", sort: r => r.shipmentDate },
    { key: "cogs", label: "COGS", align: "right", sort: r => r.cogsTotal, descFirst: true, money: r => ({ amount: r.cogsTotal, currency: ccy }) },
    { key: "saleValue", label: "Sale value", align: "right", sort: r => r.saleTotal, descFirst: true, money: r => ({ amount: r.saleTotal, currency: ccy }) },
    { key: "invoiced", label: "Invoiced", align: "right", sort: r => r.invoicedAmount, descFirst: true, money: r => ({ amount: r.invoicedAmount, currency: ccy }) },
    { key: "open", label: "Awaiting invoice", align: "right", sort: r => r.open, descFirst: true, money: r => ({ amount: r.open, currency: ccy }) },
  ], [ccy]);
  const lv = useListView(listRows, SHIP_COLS, { storageKey: "shipping", defaultSort: "date", defaultDir: "desc", summary: "open" });

  // Batch actions must never silently act on rows hidden by a filter — prune
  // the selection the same way customers/page.tsx does.
  useEffect(() => {
    const visibleIds = new Set(lv.rows.map((r: any) => r.id));
    setSel(prev => {
      const stale = Object.keys(prev).filter(id => !visibleIds.has(id));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      stale.forEach(id => delete next[id]);
      return next;
    });
  }, [lv.rows]);

  const selectableIds = useMemo(() => new Set(lv.rows.filter((r: any) => r.open > 0.005).map((r: any) => r.id)), [lv.rows]);
  const allSelected = selectableIds.size > 0 && [...selectableIds].every(id => sel[id]);
  const someSelected = [...selectableIds].some(id => sel[id]);
  function toggleAll() {
    setSel(s => {
      const next = { ...s };
      selectableIds.forEach(id => { if (allSelected) delete next[id]; else next[id] = true; });
      return next;
    });
  }

  const selected = listRows.filter(r => sel[r.id]);
  const selCustomers = [...new Set(selected.map(r => r.customerId ?? "—"))];
  const canInvoice = selected.length > 0 && selCustomers.length === 1 && selected.every(r => r.open > 0.005);

  return (
    <ListPage>
      <ListPageHeader title="Shipping" subtitle="Fulfil customer orders — against a Sales Order or ad-hoc. COGS is recognised here (Dr COGS / Cr Inventory). Then tick shipments and create an Invoice for the revenue.">
        {Object.values(sel).some(Boolean) && (
          <button disabled={!canInvoice} onClick={() => setInvoicing(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-stone-100 text-stone-900 rounded-lg px-3.5 py-2 hover:bg-white disabled:opacity-40" title={canInvoice ? "" : "Select uninvoiced shipments from one customer"}>
            <FileText size={14} /> Invoice {selected.length} shipment{selected.length > 1 ? "s" : ""}
          </button>
        )}
        <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700"><Plus size={14} /> Ship stock</button>
      </ListPageHeader>
      {voidErr && <div className="mx-4 mt-3 text-[12.5px] text-rose-400 bg-rose-950/30 border border-rose-900 rounded-lg px-3 py-2">{voidErr}</div>}

      {showNew && <ShipDrawer customers={customers} items={items} onClose={() => { setShowNew(false); load(); }} />}
      {invoicing && <InvoiceDrawer shipments={selected} onClose={() => setInvoicing(false)} onDone={() => { setInvoicing(false); setSel({}); load(); }} />}

      {rows === null ? (
        <div className="px-4 py-8 text-center text-stone-500 text-[13px]">Loading…</div>
      ) : (
        <>
          <ListToolbar lv={lv} noun="shipment" selected={selected.length} />
          <ListChips lv={lv} />
          <ListScroll lv={lv} empty={listRows.length === 0 ? "No shipments yet — record one with Ship stock." : "No shipments match the current filters."}>
            <table className={listTable}>
              <ListHead lv={lv} selection={{ all: allSelected, some: someSelected, onToggle: toggleAll }} trailing={1} />
              <tbody>
                {lv.rows.map((r: any) => {
                  const canSel = r.open > 0.005;
                  const isSel = !!sel[r.id];
                  return (
                    <tr key={r.id} className={listRow(isSel)}>
                      <td className={listCheckCell}>
                        {canSel && <input type="checkbox" checked={isSel} onChange={e => setSel(s => ({ ...s, [r.id]: e.target.checked }))} className={listCheckbox} aria-label={`Select ${r.shipmentNo || r.id}`} />}
                      </td>
                      <td className="px-2 py-2 font-mono text-[12px] text-stone-200">{r.shipmentNo || r.id.slice(0, 8)}</td>
                      <td className="px-2 py-2 text-stone-200">{r.customerLabel || "—"}</td>
                      <td className="px-2 py-2 text-stone-400">{r.shipmentDate}</td>
                      <td className={`${listNumCell} text-stone-400`}>{money(r.cogsTotal)}</td>
                      <td className={`${listNumCell} text-stone-300`}>{money(r.saleTotal)}</td>
                      <td className={`${listNumCell} text-stone-400`}>{money(r.invoicedAmount)}</td>
                      <td className={listMoneyCell}><span className={r.open > 0.005 ? "text-amber-400 font-medium" : "text-stone-500"}>{money(r.open)}</span></td>
                      <td className="px-2 py-2"><button onClick={() => voidRow(r.id, r.shipmentNo || r.id.slice(0, 8))} className="p-1 rounded hover:bg-stone-700 text-stone-600 hover:text-rose-400" title="Void shipment"><Trash2 size={13} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
              {lv.rows.length > 0 && <ListFoot lv={lv} noun="shipment" selectable trailing={1} />}
            </table>
          </ListScroll>
        </>
      )}
    </ListPage>
  );
}

/* =========================================================================
 * Ship stock — a guided drawer: Hub (ready to ship / in progress) → one
 * Sales Order's lines → capture what's actually shipping → post. Mirrors
 * Receiving's "Receive stock" drilldown (hub of open POs → items → lot
 * capture → post); the capture step itself mirrors Process MO's Output
 * capture — a pack-unit picker (QtyUnitField) anchored on the item's own
 * SKU packs (salesOrderOptions), the same domain object MO's output side
 * already captures actual production in.
 * ======================================================================= */

type SoLine = {
  lineId: string; itemId: string; skuId: string | null; itemName: string; baseUom: string | null;
  orderedBaseQty: number; shippedQty: number; remainingQty: number; saleRateBase: number; taxRateId: string | null;
};
type OpenSo = {
  id: string; docNumber: string | null; partyId: string | null; partyLabel: string | null;
  currency: string | null; exchangeRate: number; issueDate: string | null; expiryDate: string | null; lines: SoLine[];
};

// A SO with nothing shipped yet is "Ready to ship"; one line's shippedQty
// above zero moves it to "In progress" — mirrors Receiving's isStarted (PO
// received-so-far) exactly, so the two hubs behave the same way.
const isStarted = (so: OpenSo) => so.lines.some(l => l.shippedQty > QTY_EPSILON);

type View = { v: "hub" } | { v: "items"; soId: string } | { v: "capture"; soId: string; lineId: string } | { v: "adhoc" };

function ShipDrawer({ customers, items, onClose }: { customers: any[]; items: any[]; onClose: () => void }) {
  const [tab, setTab] = useState<"ready" | "inprogress">("ready");
  const [view, setView] = useState<View>({ v: "hub" });
  const [openSos, setOpenSos] = useState<OpenSo[] | null>(null);
  const [notice, setNotice] = useState("");
  const { locations } = useStockLocations();
  // Blank by default, unlike Receiving: a shipment with no location named lets
  // FIFO span every location, which is the pre-locations behaviour and still
  // right for a single-site org.
  const [locationId, setLocationId] = useState("");
  const [date, setDate] = useState(localToday());

  async function fetchSos(): Promise<OpenSo[]> {
    const r = await fetch(`/api/inventory/so-open`).then(x => x.json()).catch(() => []);
    const list: OpenSo[] = Array.isArray(r) ? r : [];
    setOpenSos(list);
    return list;
  }
  useEffect(() => { fetchSos(); }, []);

  const ready = (openSos ?? []).filter(so => !isStarted(so));
  const inProgress = (openSos ?? []).filter(isStarted);
  const selectedSo = (view.v === "items" || view.v === "capture") ? (openSos ?? []).find(s => s.id === view.soId) ?? null : null;
  const selectedLine = view.v === "capture" ? selectedSo?.lines.find(l => l.lineId === view.lineId) ?? null : null;

  function openSo(so: OpenSo) { setNotice(""); setView({ v: "items", soId: so.id }); }
  function backToHub() { setNotice(""); setView({ v: "hub" }); }

  return (
    <Drawer title="Ship stock" onClose={onClose} wide pad={false}>
      {view.v === "hub" && (
        <ShipHub ready={ready} inProgress={inProgress} loaded={openSos !== null}
          tab={tab} setTab={setTab} notice={notice} onOpenSo={openSo} onAdhoc={() => setView({ v: "adhoc" })} />
      )}
      {view.v === "items" && selectedSo && (
        <ItemsHub so={selectedSo} notice={notice} onBack={backToHub}
          onOpenLine={(lineId) => setView({ v: "capture", soId: selectedSo.id, lineId })} />
      )}
      {view.v === "capture" && selectedSo && selectedLine && (
        <ShipCapture so={selectedSo} line={selectedLine}
          date={date} setDate={setDate} locationId={locationId} setLocationId={setLocationId} locations={locations}
          onBack={() => setView({ v: "items", soId: selectedSo.id })}
          onPosted={async (msg) => {
            const fresh = await fetchSos();
            const stillOpen = fresh.find(s => s.id === selectedSo.id);
            setNotice(msg);
            setView(stillOpen ? { v: "items", soId: stillOpen.id } : { v: "hub" });
          }}
        />
      )}
      {view.v === "adhoc" && (
        <AdhocShip customers={customers} items={items} locationId={locationId} setLocationId={setLocationId} locations={locations}
          onBack={backToHub}
          onPosted={async (msg) => { await fetchSos(); setNotice(msg); setView({ v: "hub" }); }}
        />
      )}
    </Drawer>
  );
}

/* ------------------------------- Hub: SO cards --------------------------- */

function ShipHub({ ready, inProgress, loaded, tab, setTab, notice, onOpenSo, onAdhoc }: {
  ready: OpenSo[]; inProgress: OpenSo[]; loaded: boolean;
  tab: "ready" | "inprogress"; setTab: (t: "ready" | "inprogress") => void; notice: string;
  onOpenSo: (so: OpenSo) => void; onAdhoc: () => void;
}) {
  const list = tab === "ready" ? ready : inProgress;
  return (
    <>
      <div className="flex items-center gap-1 sticky top-0 z-10 bg-stone-900 px-5 pt-4 border-b border-stone-800">
        <TabButton active={tab === "ready"} onClick={() => setTab("ready")} label="Ready to ship" count={ready.length} />
        <TabButton active={tab === "inprogress"} onClick={() => setTab("inprogress")} label="In progress" count={inProgress.length} />
      </div>
      <div className="p-5">
        {notice && <div className="mb-4 text-[12.5px] text-emerald-300 bg-emerald-950/30 border border-emerald-900 rounded-lg px-3 py-2">{notice}</div>}
        {!loaded && <p className="text-[13px] text-stone-500 text-center py-10">Loading open sales orders…</p>}
        {loaded && list.length === 0 && (
          <p className="text-[13px] text-stone-500 text-center py-10">
            {tab === "ready" ? "No open sales orders are waiting to be shipped." : "Nothing is part-way through shipping right now."}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          {list.map(so => {
            const overdue = so.expiryDate && so.expiryDate < localToday();
            const linesLeft = so.lines.length;
            return (
              <button key={so.id} onClick={() => onOpenSo(so)}
                className="text-left rounded-lg border border-stone-800 bg-stone-900 hover:border-stone-700 hover:bg-stone-800/50 p-4 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-[13.5px] font-semibold text-stone-100 truncate">{so.partyLabel || "Unknown customer"}</span>
                  <ChevronRight size={15} className="text-stone-600 shrink-0" />
                </div>
                <div className="flex items-center gap-1.5 text-[12px] text-stone-400 font-mono mb-1.5">
                  <FileText size={12} className="text-violet-500" /> {so.docNumber || so.id.slice(0, 8)}
                </div>
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className={overdue ? "text-amber-400 font-medium" : "text-stone-500"}>
                    {so.expiryDate ? `Expected ${fmt.shortDate(so.expiryDate)}${overdue ? " · overdue" : ""}` : "No expected date"}
                  </span>
                  <span className="text-stone-500">{linesLeft} item{linesLeft > 1 ? "s" : ""} left</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="sticky bottom-0 z-10 bg-stone-900 border-t border-stone-800 px-5 py-3 flex items-center justify-between">
        <button onClick={onAdhoc} className="flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-400 hover:text-emerald-300">
          <Plus size={14} /> Ship without a Sales Order
        </button>
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

/* --------------------------- SO drilldown: items -------------------------- */

function ItemsHub({ so, notice, onBack, onOpenLine }: { so: OpenSo; notice: string; onBack: () => void; onOpenLine: (lineId: string) => void }) {
  return (
    <>
      <div className="sticky top-0 z-10 bg-stone-900 px-5 pt-4 pb-3 border-b border-stone-800">
        <button onClick={onBack} className="flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-300 mb-2">
          <ChevronLeft size={13} /> All open sales orders
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center shrink-0"><Truck size={15} className="text-violet-400" /></div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-stone-100 truncate">{so.partyLabel || "Unknown customer"}</div>
            <div className="text-[11.5px] text-stone-500 font-mono">{so.docNumber || so.id.slice(0, 8)}{so.expiryDate ? ` · expected ${fmt.shortDate(so.expiryDate)}` : ""}</div>
          </div>
        </div>
      </div>
      <div className="p-5">
        {notice && <div className="mb-4 text-[12.5px] text-emerald-300 bg-emerald-950/30 border border-emerald-900 rounded-lg px-3 py-2">{notice}</div>}
        <div className="grid grid-cols-2 gap-3">
          {so.lines.map(l => {
            const started = l.shippedQty > QTY_EPSILON;
            return (
              <button key={l.lineId} onClick={() => onOpenLine(l.lineId)}
                className="text-left rounded-lg border border-stone-800 bg-stone-900 hover:border-stone-700 hover:bg-stone-800/50 p-4 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="text-[13px] font-semibold text-stone-100 truncate">{l.itemName}</span>
                  <ChevronRight size={15} className="text-stone-600 shrink-0" />
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-stone-300">Remaining <span className="font-semibold text-stone-100">{qtyFmt(l.remainingQty)}</span> {l.baseUom || ""}</span>
                  {started && <span className="text-[10.5px] text-amber-400">{qtyFmt(l.shippedQty)} already shipped</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* --------------------------- Item: ship capture --------------------------- */

/**
 * Capture what's actually shipping for one SO line, in any of the item's own
 * SKU packs or its base unit (salesOrderOptions) — the same pack-unit picker
 * shape as Process MO's output capture, anchored here on the SO's own
 * ordered/shipped/remaining figures instead of an MO's expected/completed.
 */
function ShipCapture({ so, line, date, setDate, locationId, setLocationId, locations, onBack, onPosted }: {
  so: OpenSo; line: SoLine; date: string; setDate: (d: string) => void;
  locationId: string; setLocationId: (id: string) => void; locations: any[];
  onBack: () => void; onPosted: (msg: string) => void;
}) {
  const [baseUom, setBaseUom] = useState<string | null>(line.baseUom);
  const [skus, setSkus] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/inventory/items/${line.itemId}`).then(r => r.json()).then(d => {
      setBaseUom(d?.item?.baseUom ?? line.baseUom);
      setSkus(Array.isArray(d?.skus) ? d.skus : []);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.itemId]);

  const units = useMemo(() => salesOrderOptions(baseUom, skus), [baseUom, skus]);
  const defaultUnit = useMemo(() => { const i = units.findIndex(o => o.supplierSkuId === line.skuId); return i >= 0 ? i : 0; }, [units, line.skuId]);
  const [u, setU] = useState(0);
  useEffect(() => { setU(defaultUnit); }, [defaultUnit]);
  const [v, setV] = useState(() => line.remainingQty > 0 ? String(line.remainingQty) : "");
  const [saleRate, setSaleRate] = useState(String(line.saleRateBase ?? ""));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [pendingMsg, setPendingMsg] = useState("");

  const perUnit = units[u]?.unitsPerOrderUnit ?? 1;
  const qtyBase = Number((Number(v) || 0) * perUnit);
  const over = qtyBase > line.remainingQty + 1e-6;

  function setUnit(next: number) {
    const cur = qtyBase, per = units[next]?.unitsPerOrderUnit ?? 1;
    setU(next);
    if (cur > 0) setV(String(Number((cur / per).toFixed(6))));
  }

  async function submit() {
    if (!(qtyBase > 0)) { setErr("Enter a quantity to ship."); return; }
    if (over) { setErr(`That's more than the ${qtyFmt(line.remainingQty)} ${baseUom || ""} still remaining — split it across a smaller quantity, or check the order.`); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/shipping`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      customerId: so.partyId, customerLabel: so.partyLabel, shipmentDate: date, currency: so.currency, exchangeRate: so.exchangeRate,
      locationId: locationId || null,
      lines: [{ itemId: line.itemId, skuId: line.skuId, soId: so.id, soLineId: line.lineId, description: line.itemName, qtyBase, saleRate: Number(saleRate) || 0, taxRateId: line.taxRateId }],
    }) });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { setErr(d?.error || "Could not post shipment."); return; }
    if (d.pending) { setPendingMsg("This shipment exceeds your org's approval threshold and has been submitted for approval — nothing has posted yet. See Approvals."); return; }
    onPosted(`Shipped ${qtyFmt(qtyBase)} ${baseUom || ""} of ${line.itemName}${d.shipmentNo ? ` — ${d.shipmentNo} posted` : ""}.`);
  }

  return (
    <>
      <div className="sticky top-0 z-10 bg-stone-900 px-5 pt-4 pb-3 border-b border-stone-800">
        <button onClick={onBack} className="flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-300 mb-2">
          <ChevronLeft size={13} /> {so.docNumber || "Sales order"}
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center shrink-0"><Package size={15} className="text-violet-400" /></div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-stone-100 truncate">{line.itemName}</div>
            <div className="text-[11.5px] text-stone-500">Remaining {qtyFmt(line.remainingQty)} {line.baseUom || ""}</div>
          </div>
        </div>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Field label="Shipment date"><input type="date" className={controlInset} value={date} onChange={e => setDate(e.target.value)} /></Field>
          {/* issueOnly: stock in Quarantine has not been released and must not
              be shippable — hiding it here means nobody discovers that only
              after pressing Post. */}
          <LocationField label="Ship from" value={locationId} onChange={setLocationId} locations={locations} issueOnly allowAny hint="Leave as Anywhere to let FIFO pick across locations" />
        </div>

        <div className="rounded-lg border border-stone-800 bg-stone-900/40 p-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-stone-500">Ordered</div>
              <div className="text-[15px] font-medium tabular-nums text-stone-200">{qtyFmt(line.orderedBaseQty)} <span className="text-[11px] font-normal text-stone-500">{line.baseUom || ""}</span></div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-stone-500">Shipped</div>
              <div className="text-[15px] font-medium tabular-nums text-stone-200">{qtyFmt(line.shippedQty)} <span className="text-[11px] font-normal text-stone-500">{line.baseUom || ""}</span></div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-stone-500">Remaining</div>
              <div className="text-[15px] font-medium tabular-nums text-stone-200">{qtyFmt(line.remainingQty)} <span className="text-[11px] font-normal text-stone-500">{line.baseUom || ""}</span></div>
            </div>
          </div>
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-stone-500 mb-1">Shipping now</div>
            <QtyUnitField qty={v} onQty={setV} unit={String(u)} onUnit={x => setUnit(Number(x))} unitPlaceholder={null}
              options={units.map((o, i) => ({ value: String(i), label: o.label }))}
              qtyLabel={`Quantity of ${line.itemName} shipping`} unitLabel="Counted in" />
            {u > 0 && qtyBase > 0 && <div className="mt-1 text-[11px] text-stone-500 tabular-nums">= {qtyFmt(qtyBase)} {baseUom || ""}</div>}
            {over && <div className="mt-1 text-[11px] text-amber-400">More than the {qtyFmt(line.remainingQty)} {baseUom || ""} still on order — that&apos;s allowed, but check the count.</div>}
          </div>
        </div>

        <Field label={`Sale price / ${line.baseUom || "unit"}`}>
          <input type="number" className={controlInset} value={saleRate} onChange={e => setSaleRate(e.target.value)} />
        </Field>
      </div>
      <div className="sticky bottom-0 z-10 bg-stone-900 border-t border-stone-800 px-5 py-3">
        <DrawerFooter saving={saving} onClose={onBack} onSave={submit} saveLabel="Ship item" err={err} pendingMsg={pendingMsg} />
      </div>
    </>
  );
}

/* -------------------------------- Ad hoc shipping ------------------------- */

type SLine = { key: string; itemId: string; itemName: string; baseUom: string | null; skuId: string | null; qtyBase: string; saleRate: string; taxRateId: string | null };
let keySeq = 0;
const newKey = () => `s${keySeq++}`;

function AdhocShip({ customers, items, locationId, setLocationId, locations, onBack, onPosted }: {
  customers: any[]; items: any[]; locationId: string; setLocationId: (id: string) => void; locations: any[];
  onBack: () => void; onPosted: (msg: string) => void;
}) {
  const { orgSettings } = useData();
  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(localToday());
  const [currency, setCurrency] = useState("");
  const [rate, setRate] = useState("1");
  const [lines, setLines] = useState<SLine[]>([newLine()]);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const [pendingMsg, setPendingMsg] = useState("");
  const customer = customers.find(c => c.id === customerId);
  // Unlike a SO-linked shipment (which inherits the SO's own currency), an
  // ad-hoc shipment has nothing to read a foreign currency off — same gap
  // Receiving's ad-hoc form had after its own PO-drilldown rewrite, fixed the
  // same way: a toggle reveals the field, gated on the org having multi-
  // currency enabled at all (postShipment refuses otherwise).
  const [foreignCcy, setForeignCcy] = useState(false);
  const showCcy = foreignCcy || (!!currency && currency !== orgSettings.currency);

  function newLine(): SLine { return { key: newKey(), itemId: "", itemName: "", baseUom: null, skuId: null, qtyBase: "", saleRate: "", taxRateId: null }; }
  function setLine(key: string, patch: Partial<SLine>) { setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l)); }
  function onItem(key: string, itemId: string) {
    const it = items.find(x => x.id === itemId);
    setLine(key, { itemId, itemName: it?.name ?? "", baseUom: it?.baseUom ?? null, saleRate: it?.unitPrice != null ? String(it.unitPrice) : "" });
  }

  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.qtyBase) || 0) * (Number(l.saleRate) || 0), 0), [lines]);

  async function save() {
    const payloadLines = lines.filter(l => l.itemId && Number(l.qtyBase) > 0).map(l => ({
      itemId: l.itemId, skuId: l.skuId, soId: null, soLineId: null, description: l.itemName,
      qtyBase: Number(l.qtyBase), saleRate: Number(l.saleRate) || 0, taxRateId: l.taxRateId,
    }));
    if (!payloadLines.length) { setErr("Add at least one line with an item and quantity."); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/shipping`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: customerId || null, customerLabel: customer?.name ?? null, shipmentDate: date, currency: currency || null, exchangeRate: Number(rate) || 1, locationId: locationId || null, lines: payloadLines }) });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { setErr(d?.error || "Could not post shipment."); return; }
    if (d.pending) { setPendingMsg("This shipment exceeds your org's approval threshold and has been submitted for approval — nothing has posted yet. See Approvals."); return; }
    onPosted(`Shipment${d.shipmentNo ? ` ${d.shipmentNo}` : ""} posted.`);
  }

  return (
    <>
      <div className="sticky top-0 z-10 bg-stone-900 px-5 pt-4 pb-3 border-b border-stone-800">
        <button onClick={onBack} className="flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-300 mb-2"><ChevronLeft size={13} /> All open sales orders</button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center shrink-0"><Boxes size={15} className="text-violet-400" /></div>
          <div className="text-[15px] font-semibold text-stone-100">Ship without a Sales Order</div>
        </div>
      </div>
      <div className="p-5 space-y-5">
        <Section title="Customer & date">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Customer">
              <SelectField inset value={customerId} onChange={e => setCustomerId(e.target.value)}>
                <option value="">— (optional)</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </SelectField>
            </Field>
            <Field label="Shipment date"><input type="date" className={controlInset} value={date} onChange={e => setDate(e.target.value)} /></Field>
            <LocationField label="Ship from" value={locationId} onChange={setLocationId} locations={locations} issueOnly allowAny hint="Leave as Anywhere to let FIFO pick across locations" />
          </div>
          {orgSettings.multicurrencyEnabled && !showCcy && (
            <button onClick={() => { setForeignCcy(true); setCurrency(orgSettings.currency); }} className="mt-3 text-[11.5px] text-stone-500 hover:text-stone-300">
              + Shipping in a foreign currency?
            </button>
          )}
        </Section>

        <Section title={`Lines to ship${currency ? ` · ${currency}` : ""}`}
          right={<button onClick={() => setLines(ls => [...ls, newLine()])} className="flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Add line</button>}>
          <div className="space-y-2">
            {lines.map(l => (
              <div key={l.key} className="rounded-lg border border-stone-800 p-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1"><SelectField inset className="!h-8" value={l.itemId} onChange={e => onItem(l.key, e.target.value)}><option value="">Select item…</option>{items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</SelectField></div>
                  {lines.length > 1 && <button onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} className="text-stone-600 hover:text-rose-400"><Trash2 size={13} /></button>}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <Field label={`Qty (${l.baseUom || "base"})`}><input type="number" className={`${controlInset} !h-8`} value={l.qtyBase} onChange={e => setLine(l.key, { qtyBase: e.target.value })} /></Field>
                  <Field label={`Sale price / ${l.baseUom || "unit"}`}><input type="number" className={`${controlInset} !h-8`} value={l.saleRate} onChange={e => setLine(l.key, { saleRate: e.target.value })} /></Field>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {showCcy && (
          <Section title="Currency">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="Currency"><input className={controlInset} value={currency} onChange={e => setCurrency(e.target.value)} /></Field>
              <Field label="Exchange rate → home"><input type="number" className={controlInset} value={rate} onChange={e => setRate(e.target.value)} /></Field>
            </div>
          </Section>
        )}

        <div className="rounded-lg bg-violet-500/8 border border-violet-800/40 px-4 py-2.5 text-[12px] text-stone-300">Sale value → <span className="font-semibold text-violet-300">{money(total)}</span> {currency || ""} · posts Dr COGS / Cr Inventory at cost now; revenue on invoice</div>
      </div>
      <div className="sticky bottom-0 z-10 bg-stone-900 border-t border-stone-800 px-5 py-3">
        <DrawerFooter saving={saving} onClose={onBack} onSave={save} saveLabel="Post shipment" err={err} pendingMsg={pendingMsg} />
      </div>
    </>
  );
}

/* ----------------------------------- Invoice ------------------------------ */

function InvoiceDrawer({ shipments, onClose, onDone }: { shipments: any[]; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(localToday());
  const [dueDate, setDueDate] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const total = shipments.reduce((s, r) => s + Number(r.open || 0), 0);

  async function save() {
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/shipping/invoice`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shipmentIds: shipments.map(x => x.id), invoiceDate: date, dueDate: dueDate || null, reference: reference || null }) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not create invoice."); return; }
    onDone();
  }

  return (
    <Drawer title="Invoice shipments" onClose={onClose} footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Create invoice" />}>
      <p className="text-[12px] text-stone-400 mb-4">Invoicing {shipments.length} shipment{shipments.length > 1 ? "s" : ""} for <span className="text-stone-200">{shipments[0]?.customerLabel || "customer"}</span>. Posts Dr A/R / Cr Revenue (COGS already recognised at shipment).</p>
      <div className="space-y-5">
        <Section title="Invoice details">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Invoice date"><input type="date" className={controlInset} value={date} onChange={e => setDate(e.target.value)} /></Field>
            <Field label="Due date"><input type="date" className={controlInset} value={dueDate} onChange={e => setDueDate(e.target.value)} /></Field>
            <Field label="Reference / customer PO" className="col-span-2"><input className={controlInset} value={reference} onChange={e => setReference(e.target.value)} /></Field>
          </div>
        </Section>
        <div className="rounded-lg bg-stone-800/50 border border-stone-700 px-4 py-2.5 text-[12px] text-stone-300">Revenue to invoice → <span className="font-semibold text-stone-100">{money(total)}</span></div>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      </Drawer>
  );
}
