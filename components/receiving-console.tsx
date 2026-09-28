"use client";

/**
 * Receiving — post goods receipts (Dr Inventory / Cr GR/IR) against a PO or
 * ad-hoc, capturing lot/batch numbers, then create a Bill from received-but-
 * unbilled receipts (clears GR/IR → A/P). Supports partial receipts and
 * receiving/billing across multiple POs.
 */

import { useEffect, useMemo, useState } from "react";
import { useStockLocations, LocationField, defaultLocationId } from "@/components/location-picker";
import { useData } from "@/components/data-provider";
import { Plus, RefreshCw, X, Loader, Check, Trash2, FileText, ChevronLeft, ChevronRight, Truck, Package, Boxes } from "lucide-react";
import { kindOf } from "@/lib/inventory/item-kinds";
import { fmt, localToday } from "@/lib/format";
import { QTY_EPSILON } from "@/lib/inventory/round";
import { Field, Section, SelectField, controlInset, cell, th, Drawer, DrawerFooter } from "@/components/form-kit";
import {
  useListView, ListPage, ListPageHeader, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  listTable, listRow, listCheckCell, listCheckbox, listMoneyCell, listNumCell, type ListColumn,
} from "@/components/list-view";

const money = fmt.num2;

export function ReceivingConsole() {
  const { orgSettings } = useData() as any;
  const ccy = orgSettings?.currency ?? "EUR";
  const [rows, setRows] = useState<any[] | null>(null);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [taxes, setTaxes] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [billing, setBilling] = useState(false);
  const [voidErr, setVoidErr] = useState("");

  async function load() {
    const r = await fetch(`/api/inventory/receiving`).then(x => x.json()).catch(() => []);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => {
    load();
    fetch(`/api/parties/suppliers?native=1`).then(x => x.json()).then(r => setSuppliers(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/inventory/items`).then(x => x.json()).then(r => setItems(Array.isArray(r) ? r.filter((i: any) => kindOf(i.productType).tracked) : [])).catch(() => {});
    fetch(`/api/accounting/tax-rates`).then(x => x.json()).then(r => setTaxes(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);
  useEffect(() => { if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") setShowNew(true); }, []);

  async function voidRow(id: string, no: string) {
    if (!confirm(`Void receipt ${no}? This reverses the stock and its GL entry.`)) return;
    setVoidErr("");
    const r = await fetch(`/api/inventory/receiving/${id}`, { method: "DELETE" });
    if (!r.ok) { setVoidErr((await r.json().catch(() => ({})))?.error || "Could not void receipt."); return; }
    load();
  }

  const listRows = rows ?? [];
  const RECV_COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "receiptNo", label: "Receipt #", sort: r => r.receiptNo, filter: { kind: "text", value: r => r.receiptNo } },
    { key: "supplier", label: "Supplier", sort: r => r.supplierLabel, filter: { kind: "multi", value: r => r.supplierLabel } },
    { key: "date", label: "Date", sort: r => r.receiptDate },
    { key: "grirTotal", label: "Received value", align: "right", sort: r => r.grirTotal, descFirst: true, money: r => ({ amount: r.grirTotal, currency: ccy }) },
    { key: "billedAmount", label: "Billed", align: "right", sort: r => r.billedAmount, descFirst: true, money: r => ({ amount: r.billedAmount, currency: ccy }) },
    { key: "open", label: "Awaiting bill", align: "right", sort: r => r.open, descFirst: true, money: r => ({ amount: r.open, currency: ccy }) },
  ], [ccy]);
  const lv = useListView(listRows, RECV_COLS, { storageKey: "receiving", defaultSort: "date", defaultDir: "desc", summary: "open" });

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

  const selectedIds = Object.keys(sel).filter(k => sel[k]);
  const selectedReceipts = listRows.filter(r => sel[r.id]);
  const selSuppliers = [...new Set(selectedReceipts.map(r => r.supplierId ?? "—"))];
  const canBill = selectedReceipts.length > 0 && selSuppliers.length === 1 && selectedReceipts.every(r => r.open > 0.005);

  return (
    <ListPage>
      <ListPageHeader title="Receiving" subtitle="Record goods received into stock — against a PO or ad-hoc. Then tick received receipts and create a Bill to clear the GR/IR accrual to Accounts Payable.">
        {selectedIds.length > 0 && (
          <button disabled={!canBill} onClick={() => setBilling(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-stone-100 text-stone-900 rounded-lg px-3.5 py-2 hover:bg-white disabled:opacity-40" title={canBill ? "" : "Select unbilled receipts from one supplier"}>
            <FileText size={14} /> Bill {selectedIds.length} receipt{selectedIds.length > 1 ? "s" : ""}
          </button>
        )}
        <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700"><Plus size={14} /> Receive stock</button>
      </ListPageHeader>
      {voidErr && <div className="mx-4 mt-3 text-[12.5px] text-rose-400 bg-rose-950/30 border border-rose-900 rounded-lg px-3 py-2">{voidErr}</div>}

      {showNew && <ReceiveDrawer suppliers={suppliers} items={items} onClose={() => { setShowNew(false); load(); }} />}
      {billing && <BillDrawer receipts={selectedReceipts} taxes={taxes} onClose={() => setBilling(false)} onDone={() => { setBilling(false); setSel({}); load(); }} />}

      {rows === null ? (
        <div className="px-4 py-8 text-center text-stone-500 text-[13px]">Loading…</div>
      ) : (
        <>
          <ListToolbar lv={lv} noun="receipt" selected={selectedIds.length} />
          <ListChips lv={lv} />
          <ListScroll lv={lv} empty={listRows.length === 0 ? "No goods receipts yet — record one with Receive stock." : "No receipts match the current filters."}>
            <table className={listTable}>
              <ListHead lv={lv} selection={{ all: allSelected, some: someSelected, onToggle: toggleAll }} trailing={1} />
              <tbody>
                {lv.rows.map((r: any) => {
                  const canSel = r.open > 0.005;
                  const isSel = !!sel[r.id];
                  return (
                    <tr key={r.id} className={listRow(isSel)}>
                      <td className={listCheckCell}>
                        {canSel && <input type="checkbox" checked={isSel} onChange={e => setSel(s => ({ ...s, [r.id]: e.target.checked }))} className={listCheckbox} aria-label={`Select ${r.receiptNo || r.id}`} />}
                      </td>
                      <td className="px-2 py-2 font-mono text-[12px] text-stone-200">{r.receiptNo || r.id.slice(0, 8)}</td>
                      <td className="px-2 py-2 text-stone-200">{r.supplierLabel || "—"}</td>
                      <td className="px-2 py-2 text-stone-400">{r.receiptDate}</td>
                      <td className={`${listNumCell} text-stone-300`}>{money(r.grirTotal)}</td>
                      <td className={`${listNumCell} text-stone-400`}>{money(r.billedAmount)}</td>
                      <td className={listMoneyCell}><span className={r.open > 0.005 ? "text-amber-400 font-medium" : "text-stone-500"}>{money(r.open)}</span></td>
                      <td className="px-2 py-2"><button onClick={() => voidRow(r.id, r.receiptNo || r.id.slice(0, 8))} className="p-1 rounded hover:bg-stone-700 text-stone-600 hover:text-rose-400" title="Void receipt"><Trash2 size={13} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
              {lv.rows.length > 0 && <ListFoot lv={lv} noun="receipt" selectable trailing={1} />}
            </table>
          </ListScroll>
        </>
      )}
    </ListPage>
  );
}

type RLine = { key: string; itemId: string; itemName: string; baseUom: string | null; skuId: string | null; poId: string | null; poLineId: string | null; qtyBase: string; unitCost: string; lotNo: string; expiryDate: string; supplierBatchNo: string; productionDate: string; bestBeforeDate: string };
let keySeq = 0;
const newKey = () => `l${keySeq++}`;

// Finished Product / Work in Progress lots are always system-generated at
// commit time (never editable here); Stock Item / Raw Material get a
// suggested code pre-filled — accept it or overwrite with the supplier's own
// batch number.
function isFPWIP(it: any) { return ["FinishedProduct", "WorkInProgress"].includes(kindOf(it?.productType).kind); }

type PoLine = {
  lineId: string; itemId: string; skuId: string | null; itemName: string; skuLabel: string | null;
  baseUom: string | null; orderedBaseQty: number; receivedQty: number; remainingQty: number; unitCostBase: number;
};
type OpenPo = {
  id: string; docNumber: string | null; partyId: string | null; partyLabel: string | null;
  currency: string | null; exchangeRate: number; issueDate: string | null; expiryDate: string | null; lines: PoLine[];
};
type LotRow = { key: string; qty: string; lotNo: string; expiryDate: string; supplierBatchNo: string; productionDate: string; bestBeforeDate: string };
let lotKeySeq = 0;
const newLotRow = (qty = ""): LotRow => ({ key: `lot${lotKeySeq++}`, qty, lotNo: "", expiryDate: "", supplierBatchNo: "", productionDate: "", bestBeforeDate: "" });
const lotQtyTotal = (rows: LotRow[]) => rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);

// A PO with nothing received yet is "Expected"; one line's receivedQty above
// zero moves the whole PO to "In progress" — it stays there until every line
// is fully received, at which point po-open stops returning it and it drops
// off both tabs (fully received receipts are visible only as GRNs on the
// Receiving page itself, per the product decision this drawer implements).
const isStarted = (po: OpenPo) => po.lines.some(l => l.receivedQty > QTY_EPSILON);

type View = { v: "hub" } | { v: "items"; poId: string } | { v: "lots"; poId: string; lineId: string } | { v: "adhoc" };

function ReceiveDrawer({ suppliers, items, onClose }: { suppliers: any[]; items: any[]; onClose: () => void }) {
  const [tab, setTab] = useState<"expected" | "inprogress">("expected");
  const [view, setView] = useState<View>({ v: "hub" });
  const [openPos, setOpenPos] = useState<OpenPo[] | null>(null);
  const [notice, setNotice] = useState("");
  const { locations } = useStockLocations();
  const [locationId, setLocationId] = useState("");
  useEffect(() => { if (!locationId && locations.length) setLocationId(defaultLocationId(locations)); }, [locations]);
  const [date, setDate] = useState(localToday());

  async function fetchPos(): Promise<OpenPo[]> {
    const r = await fetch(`/api/inventory/po-open`).then(x => x.json()).catch(() => []);
    const list: OpenPo[] = Array.isArray(r) ? r : [];
    setOpenPos(list);
    return list;
  }
  useEffect(() => { fetchPos(); }, []);

  const expected = (openPos ?? []).filter(po => !isStarted(po));
  const inProgress = (openPos ?? []).filter(isStarted);
  const selectedPo = (view.v === "items" || view.v === "lots") ? (openPos ?? []).find(p => p.id === view.poId) ?? null : null;
  const selectedLine = view.v === "lots" ? selectedPo?.lines.find(l => l.lineId === view.lineId) ?? null : null;

  function openPo(po: OpenPo) { setNotice(""); setView({ v: "items", poId: po.id }); }
  function backToHub() { setNotice(""); setView({ v: "hub" }); }

  return (
    <Drawer title="Receive stock" onClose={onClose} wide pad={false}>
      {view.v === "hub" && (
          <ReceiveHub
            expected={expected} inProgress={inProgress} loaded={openPos !== null}
            tab={tab} setTab={setTab} notice={notice}
            onOpenPo={openPo} onAdhoc={() => setView({ v: "adhoc" })}
          />
        )}
        {view.v === "items" && selectedPo && (
          <ItemsHub po={selectedPo} notice={notice} onBack={backToHub}
            onOpenLine={(lineId) => setView({ v: "lots", poId: selectedPo.id, lineId })} />
        )}
        {view.v === "lots" && selectedPo && selectedLine && (
          <LotCapture
            po={selectedPo} line={selectedLine} items={items}
            date={date} setDate={setDate} locationId={locationId} setLocationId={setLocationId} locations={locations}
            onBack={() => setView({ v: "items", poId: selectedPo.id })}
            onPosted={async (msg) => {
              const fresh = await fetchPos();
              const stillOpen = fresh.find(p => p.id === selectedPo.id);
              setNotice(msg);
              setView(stillOpen ? { v: "items", poId: stillOpen.id } : { v: "hub" });
            }}
          />
        )}
        {view.v === "adhoc" && (
          <AdhocReceive suppliers={suppliers} items={items} locationId={locationId} setLocationId={setLocationId} locations={locations}
            onBack={backToHub}
            onPosted={async (msg) => { await fetchPos(); setNotice(msg); setView({ v: "hub" }); }}
          />
        )}
    </Drawer>
  );
}

/* ------------------------------- Hub: PO cards -------------------------- */

function ReceiveHub({ expected, inProgress, loaded, tab, setTab, notice, onOpenPo, onAdhoc }: {
  expected: OpenPo[]; inProgress: OpenPo[]; loaded: boolean;
  tab: "expected" | "inprogress"; setTab: (t: "expected" | "inprogress") => void; notice: string;
  onOpenPo: (po: OpenPo) => void; onAdhoc: () => void;
}) {
  const list = tab === "expected" ? expected : inProgress;
  return (
    <>
      <div className="flex items-center gap-1 sticky top-0 z-10 bg-stone-900 px-5 pt-4 border-b border-stone-800">
        <TabButton active={tab === "expected"} onClick={() => setTab("expected")} label="Expected receiving" count={expected.length} />
        <TabButton active={tab === "inprogress"} onClick={() => setTab("inprogress")} label="In progress" count={inProgress.length} />
      </div>
      <div className="p-5">
        {notice && <div className="mb-4 text-[12.5px] text-emerald-300 bg-emerald-950/30 border border-emerald-900 rounded-lg px-3 py-2">{notice}</div>}
        {!loaded && <p className="text-[13px] text-stone-500 text-center py-10">Loading open purchase orders…</p>}
        {loaded && list.length === 0 && (
          <p className="text-[13px] text-stone-500 text-center py-10">
            {tab === "expected" ? "No open purchase orders are waiting to be received." : "Nothing is part-way through receiving right now."}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          {list.map(po => {
            const overdue = po.expiryDate && po.expiryDate < localToday();
            const linesLeft = po.lines.length;
            return (
              <button key={po.id} onClick={() => onOpenPo(po)}
                className="text-left rounded-lg border border-stone-800 bg-stone-900 hover:border-stone-700 hover:bg-stone-800/50 p-4 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-[13.5px] font-semibold text-stone-100 truncate">{po.partyLabel || "Unknown supplier"}</span>
                  <ChevronRight size={15} className="text-stone-600 shrink-0" />
                </div>
                <div className="flex items-center gap-1.5 text-[12px] text-stone-400 font-mono mb-1.5">
                  <FileText size={12} className="text-cyan-500" /> {po.docNumber || po.id.slice(0, 8)}
                </div>
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className={overdue ? "text-amber-400 font-medium" : "text-stone-500"}>
                    {po.expiryDate ? `Expected ${fmt.shortDate(po.expiryDate)}${overdue ? " · overdue" : ""}` : "No expected date"}
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
          <Plus size={14} /> Receive without a PO
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

/* --------------------------- PO drilldown: items ------------------------- */

function ItemsHub({ po, notice, onBack, onOpenLine }: { po: OpenPo; notice: string; onBack: () => void; onOpenLine: (lineId: string) => void }) {
  return (
    <>
      <div className="sticky top-0 z-10 bg-stone-900 px-5 pt-4 pb-3 border-b border-stone-800">
        <button onClick={onBack} className="flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-300 mb-2">
          <ChevronLeft size={13} /> All open purchase orders
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center shrink-0"><Truck size={15} className="text-cyan-400" /></div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-stone-100 truncate">{po.partyLabel || "Unknown supplier"}</div>
            <div className="text-[11.5px] text-stone-500 font-mono">{po.docNumber || po.id.slice(0, 8)}{po.expiryDate ? ` · expected ${fmt.shortDate(po.expiryDate)}` : ""}</div>
          </div>
        </div>
      </div>
      <div className="p-5">
        {notice && <div className="mb-4 text-[12.5px] text-emerald-300 bg-emerald-950/30 border border-emerald-900 rounded-lg px-3 py-2">{notice}</div>}
        <div className="grid grid-cols-2 gap-3">
          {po.lines.map(l => {
            const started = l.receivedQty > QTY_EPSILON;
            return (
              <button key={l.lineId} onClick={() => onOpenLine(l.lineId)}
                className="text-left rounded-lg border border-stone-800 bg-stone-900 hover:border-stone-700 hover:bg-stone-800/50 p-4 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="text-[13px] font-semibold text-stone-100 truncate">{l.itemName}</span>
                  <ChevronRight size={15} className="text-stone-600 shrink-0" />
                </div>
                {l.skuLabel && <div className="text-[11.5px] text-stone-500 mb-1.5 truncate">{l.skuLabel}</div>}
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-stone-300">Expected <span className="font-semibold text-stone-100">{fmt.qty(l.remainingQty)}</span> {l.baseUom || ""}</span>
                  {started && <span className="text-[10.5px] text-amber-400">{fmt.qty(l.receivedQty)} already in</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ----------------------------- Item: lot capture -------------------------- */

function LotCapture({ po, line, items, date, setDate, locationId, setLocationId, locations, onBack, onPosted }: {
  po: OpenPo; line: PoLine; items: any[]; date: string; setDate: (d: string) => void;
  locationId: string; setLocationId: (id: string) => void; locations: any[];
  onBack: () => void; onPosted: (msg: string) => void;
}) {
  const item = items.find(i => i.id === line.itemId);
  const fpwip = isFPWIP(item);
  const [rows, setRows] = useState<LotRow[]>(() => [newLotRow(String(line.remainingQty))]);
  const [moreFor, setMoreFor] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [pendingMsg, setPendingMsg] = useState("");

  useEffect(() => {
    if (fpwip) return;
    // One suggestion for the single starting row — accept it or overwrite.
    fetch(`/api/inventory/lot-suggestion`).then(r => r.json()).then(s => {
      if (s?.code) setRows(rs => rs.map((r, i) => i === 0 ? { ...r, lotNo: s.code } : r));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.lineId]);

  function update(key: string, patch: Partial<LotRow>) { setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r)); }
  async function addRow() {
    const remaining = Math.max(0, line.remainingQty - lotQtyTotal(rows));
    const row = newLotRow(remaining > 0 ? String(remaining) : "");
    setRows(rs => [...rs, row]);
    if (!fpwip) {
      const s = await fetch(`/api/inventory/lot-suggestion`).then(r => r.json()).catch(() => null);
      if (s?.code) update(row.key, { lotNo: s.code });
    }
  }
  function removeRow(key: string) { setRows(rs => rs.filter(r => r.key !== key)); }

  const total = lotQtyTotal(rows);
  const over = total - line.remainingQty > QTY_EPSILON;

  async function submit() {
    const payloadLines = rows.filter(r => Number(r.qty) > 0).map(r => ({
      itemId: line.itemId, skuId: line.skuId, poId: po.id, poLineId: line.lineId, description: line.itemName,
      qtyBase: Number(r.qty), unitCost: line.unitCostBase,
      lotNo: r.lotNo || null, expiryDate: r.expiryDate || null,
      supplierBatchNo: r.supplierBatchNo || null, productionDate: r.productionDate || null, bestBeforeDate: r.bestBeforeDate || null,
    }));
    if (!payloadLines.length) { setErr("Enter a quantity for at least one lot."); return; }
    if (over) { setErr(`That's more than the ${fmt.qty(line.remainingQty)} ${line.baseUom || ""} still expected — split it across a smaller quantity, or check the PO.`); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/receiving`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      supplierId: po.partyId, supplierLabel: po.partyLabel, receiptDate: date,
      currency: po.currency, exchangeRate: po.exchangeRate, locationId: locationId || null, lines: payloadLines,
    }) });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { setErr(d?.error || "Could not post receipt."); return; }
    if (d.pending) { setPendingMsg("This receipt exceeds your org's approval threshold and has been submitted for approval — nothing has posted yet. See Approvals."); return; }
    const qty = payloadLines.reduce((s, l) => s + l.qtyBase, 0);
    onPosted(`Received ${fmt.qty(qty)} ${line.baseUom || ""} of ${line.itemName}${d.receiptNo ? ` — ${d.receiptNo} posted` : ""}.`);
  }

  return (
    <>
      <div className="sticky top-0 z-10 bg-stone-900 px-5 pt-4 pb-3 border-b border-stone-800">
        <button onClick={onBack} className="flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-300 mb-2">
          <ChevronLeft size={13} /> {po.docNumber || "Purchase order"}
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center shrink-0"><Package size={15} className="text-cyan-400" /></div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-stone-100 truncate">{line.itemName}</div>
            <div className="text-[11.5px] text-stone-500">{line.skuLabel ? `${line.skuLabel} · ` : ""}Expecting {fmt.qty(line.remainingQty)} {line.baseUom || ""}</div>
          </div>
        </div>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Field label="Receipt date"><input type="date" className={controlInset} value={date} onChange={e => setDate(e.target.value)} /></Field>
          <LocationField label="Receive into" value={locationId} onChange={setLocationId} locations={locations} hint="Where the goods physically landed" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11.5px] font-semibold text-stone-500 uppercase tracking-wide">Lots received</span>
            <button onClick={addRow} className="flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Add another lot</button>
          </div>
          <p className="text-[11.5px] text-stone-500 mb-2">
            {fpwip ? "This item's lot number is assigned automatically when it's produced." : "Split the delivery into more than one lot if it arrived with different batch numbers or expiry dates."}
          </p>
          <div className="space-y-2">
            {rows.map((r, idx) => (
              <div key={r.key} className="rounded-lg border border-stone-800 p-3">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[11.5px] font-semibold text-stone-400">Lot {idx + 1}</span>
                  {rows.length > 1 && <button onClick={() => removeRow(r.key)} className="text-stone-600 hover:text-rose-400"><Trash2 size={13} /></button>}
                </div>
                <div className="grid grid-cols-3 gap-x-3 gap-y-3">
                  <Field label={`Qty (${line.baseUom || "base"})`}><input type="number" className={`${controlInset} !h-8`} value={r.qty} onChange={e => update(r.key, { qty: e.target.value })} /></Field>
                  <Field label="Lot / batch no.">
                    {fpwip
                      ? <input className={`${controlInset} !h-8 opacity-60`} value="assigned automatically" disabled />
                      : <input className={`${controlInset} !h-8`} value={r.lotNo} onChange={e => update(r.key, { lotNo: e.target.value })} />}
                  </Field>
                  <Field label="Expiry"><input type="date" className={`${controlInset} !h-8`} value={r.expiryDate} onChange={e => update(r.key, { expiryDate: e.target.value })} /></Field>
                </div>
                {moreFor[r.key] ? (
                  <div className="grid grid-cols-3 gap-x-3 gap-y-3 mt-3 pt-3 border-t border-stone-800/60">
                    <Field label="Supplier batch no." hint="As printed — GS1 (10)"><input className={`${controlInset} !h-8`} value={r.supplierBatchNo} onChange={e => update(r.key, { supplierBatchNo: e.target.value })} /></Field>
                    <Field label="Production date"><input type="date" className={`${controlInset} !h-8`} value={r.productionDate} onChange={e => update(r.key, { productionDate: e.target.value })} /></Field>
                    <Field label="Best before"><input type="date" className={`${controlInset} !h-8`} value={r.bestBeforeDate} onChange={e => update(r.key, { bestBeforeDate: e.target.value })} /></Field>
                  </div>
                ) : (
                  <button onClick={() => setMoreFor(m => ({ ...m, [r.key]: true }))} className="mt-2 text-[11.5px] text-stone-500 hover:text-stone-300">+ Supplier batch, production &amp; best-before dates</button>
                )}
              </div>
            ))}
          </div>
          <div className={`mt-2 text-[11.5px] ${over ? "text-rose-400" : "text-stone-500"}`}>
            {fmt.qty(total)} of {fmt.qty(line.remainingQty)} {line.baseUom || ""} entered{over ? " — that's more than expected" : ""}
          </div>
        </div>
      </div>
      <div className="sticky bottom-0 z-10 bg-stone-900 border-t border-stone-800 px-5 py-3">
        <DrawerFooter saving={saving} onClose={pendingMsg ? onBack : onBack} onSave={submit} saveLabel="Receive item" err={err} pendingMsg={pendingMsg} />
      </div>
    </>
  );
}

/* ------------------------------- Ad hoc receiving ------------------------- */

function AdhocReceive({ suppliers, items, locationId, setLocationId, locations, onBack, onPosted }: {
  suppliers: any[]; items: any[]; locationId: string; setLocationId: (id: string) => void; locations: any[];
  onBack: () => void; onPosted: (msg: string) => void;
}) {
  const { orgSettings } = useData();
  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(localToday());
  const [currency, setCurrency] = useState("");
  const [rate, setRate] = useState("1");
  const [lines, setLines] = useState<RLine[]>([newLine()]);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const [pendingMsg, setPendingMsg] = useState("");
  const supplier = suppliers.find(s => s.id === supplierId);
  // Unlike a PO-linked receipt (which inherits the PO's own currency), an
  // ad-hoc receipt has nothing to read a foreign currency off — so the
  // toggle is what reveals the field at all, gated on the org actually
  // having multi-currency enabled (postGoodsReceipt refuses otherwise).
  const [foreignCcy, setForeignCcy] = useState(false);
  const showCcy = foreignCcy || (!!currency && currency !== orgSettings.currency);

  function newLine(): RLine { return { key: newKey(), itemId: "", itemName: "", baseUom: null, skuId: null, poId: null, poLineId: null, qtyBase: "", unitCost: "", lotNo: "", expiryDate: "", supplierBatchNo: "", productionDate: "", bestBeforeDate: "" }; }
  function setLine(key: string, patch: Partial<RLine>) { setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l)); }
  async function onItem(key: string, itemId: string) {
    const it = items.find(x => x.id === itemId);
    setLine(key, { itemId, itemName: it?.name ?? "", baseUom: it?.baseUom ?? null, unitCost: it?.unitCost != null ? String(it.unitCost) : "", lotNo: "" });
    if (it && !isFPWIP(it)) {
      const s = await fetch(`/api/inventory/lot-suggestion`).then(r => r.json()).catch(() => null);
      if (s?.code) setLine(key, { lotNo: s.code });
    }
  }

  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.qtyBase) || 0) * (Number(l.unitCost) || 0), 0), [lines]);

  async function save() {
    const payloadLines = lines.filter(l => l.itemId && Number(l.qtyBase) > 0).map(l => ({
      itemId: l.itemId, skuId: l.skuId, poId: null, poLineId: null, description: l.itemName,
      qtyBase: Number(l.qtyBase), unitCost: Number(l.unitCost) || 0, lotNo: l.lotNo || null, expiryDate: l.expiryDate || null,
      supplierBatchNo: l.supplierBatchNo || null, productionDate: l.productionDate || null, bestBeforeDate: l.bestBeforeDate || null,
    }));
    if (!payloadLines.length) { setErr("Add at least one line with an item and quantity."); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/receiving`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplierId: supplierId || null, supplierLabel: supplier?.name ?? null, receiptDate: date, currency: currency || null, exchangeRate: Number(rate) || 1, locationId: locationId || null, lines: payloadLines }) });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { setErr(d?.error || "Could not post receipt."); return; }
    if (d.pending) { setPendingMsg("This receipt exceeds your org's approval threshold and has been submitted for approval — nothing has posted yet. See Approvals."); return; }
    onPosted(`Receipt${d.receiptNo ? ` ${d.receiptNo}` : ""} posted.`);
  }

  return (
    <>
      <div className="sticky top-0 z-10 bg-stone-900 px-5 pt-4 pb-3 border-b border-stone-800">
        <button onClick={onBack} className="flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-300 mb-2"><ChevronLeft size={13} /> All open purchase orders</button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center shrink-0"><Boxes size={15} className="text-cyan-400" /></div>
          <div className="text-[15px] font-semibold text-stone-100">Receive without a PO</div>
        </div>
      </div>
      <div className="p-5 space-y-5">
        <Section title="Supplier & date">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Supplier">
              <SelectField inset value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">— (optional)</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </SelectField>
            </Field>
            <Field label="Receipt date"><input type="date" className={controlInset} value={date} onChange={e => setDate(e.target.value)} /></Field>
            <LocationField label="Receive into" value={locationId} onChange={setLocationId} locations={locations} hint="Where the goods physically landed" />
          </div>
          {orgSettings.multicurrencyEnabled && !showCcy && (
            <button onClick={() => { setForeignCcy(true); setCurrency(orgSettings.currency); }} className="mt-3 text-[11.5px] text-stone-500 hover:text-stone-300">
              + Receiving in a foreign currency?
            </button>
          )}
        </Section>

        <Section title={`Lines to receive${currency ? ` · ${currency}` : ""}`}
          right={<button onClick={() => setLines(ls => [...ls, newLine()])} className="flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Add line</button>}>
          <div className="space-y-2">
            {lines.map(l => (
              <div key={l.key} className="rounded-lg border border-stone-800 p-3">
                <div className="flex items-center gap-2 mb-3">
                  <SelectField inset className="!h-8" value={l.itemId} onChange={e => onItem(l.key, e.target.value)}><option value="">Select item…</option>{items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</SelectField>
                  {lines.length > 1 && <button onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} className="ml-auto text-stone-600 hover:text-rose-400"><Trash2 size={13} /></button>}
                </div>
                <div className="grid grid-cols-4 gap-x-4 gap-y-4">
                  <Field label={`Qty (${l.baseUom || "base"})`}><input type="number" className={`${controlInset} !h-8`} value={l.qtyBase} onChange={e => setLine(l.key, { qtyBase: e.target.value })} /></Field>
                  <Field label="Unit cost"><input type="number" className={`${controlInset} !h-8`} value={l.unitCost} onChange={e => setLine(l.key, { unitCost: e.target.value })} /></Field>
                  <Field label="Lot / batch no.">
                    {isFPWIP(items.find(x => x.id === l.itemId)) ? (
                      <input className={`${controlInset} !h-8 opacity-60`} value="assigned automatically" disabled />
                    ) : (
                      <input className={`${controlInset} !h-8`} value={l.lotNo} onChange={e => setLine(l.key, { lotNo: e.target.value })} />
                    )}
                  </Field>
                  <Field label="Expiry"><input type="date" className={`${controlInset} !h-8`} value={l.expiryDate} onChange={e => setLine(l.key, { expiryDate: e.target.value })} /></Field>
                  <Field label="Supplier batch no." hint="As printed — GS1 (10)"><input className={`${controlInset} !h-8`} value={l.supplierBatchNo} onChange={e => setLine(l.key, { supplierBatchNo: e.target.value })} /></Field>
                  <Field label="Production date"><input type="date" className={`${controlInset} !h-8`} value={l.productionDate} onChange={e => setLine(l.key, { productionDate: e.target.value })} /></Field>
                  <Field label="Best before"><input type="date" className={`${controlInset} !h-8`} value={l.bestBeforeDate} onChange={e => setLine(l.key, { bestBeforeDate: e.target.value })} /></Field>
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

        <div className="rounded-lg bg-cyan-500/8 border border-cyan-800/40 px-4 py-2.5 text-[12px] text-stone-300">Receipt value → <span className="font-semibold text-cyan-300">{money(total)}</span> {currency || ""} · posts Dr Inventory / Cr GR/IR</div>
      </div>
      <div className="sticky bottom-0 z-10 bg-stone-900 border-t border-stone-800 px-5 py-3">
        <DrawerFooter saving={saving} onClose={onBack} onSave={save} saveLabel="Post receipt" err={err} pendingMsg={pendingMsg} />
      </div>
    </>
  );
}

function BillDrawer({ receipts, taxes, onClose, onDone }: { receipts: any[]; taxes: any[]; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(localToday());
  const [dueDate, setDueDate] = useState("");
  const [reference, setReference] = useState("");
  const [taxRateId, setTaxRateId] = useState("");
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const [lines, setLines] = useState<any[] | null>(null);
  const [price, setPrice] = useState<Record<string, string>>({});   // lineId -> invoice unit price
  useEffect(() => {
    fetch(`/api/inventory/receiving/bill?ids=${receipts.map(x => x.id).join(",")}`).then(r => r.json())
      .then(d => { const ls = Array.isArray(d) ? d : []; setLines(ls); setPrice(Object.fromEntries(ls.map((l: any) => [l.id, String(l.unitCost)]))); }).catch(() => setLines([]));
  }, [receipts]);
  // In the receipts' own currency, like the prices below (fall back to the list's figure while loading).
  const total = lines ? Math.round(lines.reduce((s, l) => s + l.open * l.unitCost, 0) * 100) / 100 : receipts.reduce((s, r) => s + Number(r.open || 0), 0);
  const invoiced = (lines ?? []).reduce((s, l) => s + l.open * (Number(price[l.id]) || 0), 0);
  const diff = Math.round((invoiced - total) * 100) / 100;

  async function save() {
    setSaving(true); setErr("");
    const prices = (lines ?? []).filter(l => price[l.id] !== "" && Math.abs((Number(price[l.id]) || 0) - l.unitCost) > 1e-9).map(l => ({ lineId: l.id, unitCost: Number(price[l.id]) || 0 }));
    const r = await fetch(`/api/inventory/receiving/bill`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiptIds: receipts.map(x => x.id), billDate: date, dueDate: dueDate || null, reference: reference || null, taxRateId: taxRateId || null, prices }) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not create bill."); return; }
    onDone();
  }

  return (
    <Drawer title="Create bill from receipts" onClose={onClose} footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Create bill" />}>
      <p className="text-[12px] text-stone-400 mb-4">Billing {receipts.length} receipt{receipts.length > 1 ? "s" : ""} for <span className="text-stone-200">{receipts[0]?.supplierLabel || "supplier"}</span>. Posts Dr GR/IR clearing / Cr Accounts Payable.</p>
      <div className="space-y-5">
        <Section title="Bill details">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Bill date"><input type="date" className={controlInset} value={date} onChange={e => setDate(e.target.value)} /></Field>
            <Field label="Due date"><input type="date" className={controlInset} value={dueDate} onChange={e => setDueDate(e.target.value)} /></Field>
            <Field label="Supplier bill reference" className="col-span-2"><input className={controlInset} value={reference} onChange={e => setReference(e.target.value)} placeholder="Supplier invoice no." /></Field>
            <Field label="Tax" className="col-span-2">
              <SelectField inset value={taxRateId} onChange={e => setTaxRateId(e.target.value)}>
                <option value="">No tax</option>
                {taxes.map(t => <option key={t.id} value={t.id}>{t.name} ({Number(t.rate)}%)</option>)}
              </SelectField>
            </Field>
          </div>
        </Section>
        <Section title="Invoice prices" desc="Change a price only where the supplier's invoice differs from the receipt. The difference on stock still held goes into that lot's cost; on stock already used, to purchase price variance.">
          <div className="rounded-lg border border-stone-800 overflow-hidden">
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-stone-800"><th className={th}>Item</th><th className={`${th} text-right`}>To bill</th><th className={`${th} text-right`}>Receipt price</th><th className={`${th} text-right w-32`}>Invoice price</th></tr></thead>
              <tbody>
                {lines === null && <tr><td colSpan={4} className="px-3 py-3 text-center text-stone-500">Loading…</td></tr>}
                {(lines ?? []).map(l => (
                  <tr key={l.id} className="border-b border-stone-800/50">
                    <td className="px-3 py-1.5 text-stone-200">{l.itemName ?? "—"} <span className="text-stone-500 font-mono text-[11px]">{l.receiptNo}</span></td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-stone-300">{fmt.qty(l.open)} {l.baseUom || ""}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-stone-400">{fmt.num2(l.unitCost)}</td>
                    <td className="px-3 py-1"><input type="number" min="0" step="any" className={`${cell} text-right tabular-nums`} value={price[l.id] ?? ""} onChange={e => setPrice(p => ({ ...p, [l.id]: e.target.value }))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <div className="rounded-lg bg-stone-800/50 border border-stone-700 px-4 py-2.5 text-[12px] text-stone-300">
          Clears GR/IR → <span className="font-semibold text-stone-100">{money(total)}</span>
          {Math.abs(diff) >= 0.005 && <> · price difference <span className={diff > 0 ? "text-amber-300" : "text-emerald-300"}>{diff > 0 ? "+" : ""}{money(diff)}</span> · bill total <span className="font-semibold text-stone-100">{money(total + diff)}</span></>}
        </div>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      </Drawer>
  );
}

/* ----------------------------- Drawer shell ----------------------------- */


