"use client";

/**
 * Stock Transfers — move stock between locations.
 *
 * The design principle here is that an operator should never have to guess.
 * Picking a source location loads what is ACTUALLY there, lot by lot, in FIFO
 * order; the item picker offers only those items; the quantity field knows the
 * maximum. A transfer that cannot succeed should be impossible to submit, not
 * rejected after the fact.
 *
 * Lot choice is optional and that is deliberate: leaving it blank lets FIFO
 * pick, which is what someone moving a pallet of one thing wants. Naming lots
 * matters when the physical boxes being carried are specific ones — which is
 * the case this business actually runs on, since cost follows the lot.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight, Plus, Loader2, Trash2, AlertTriangle, PackageSearch, X,
} from "lucide-react";
import { Button, Badge, Card, Modal, EmptyState, Toast } from "@/components/ui";
import { Field, SelectField, Section, control, cell, th } from "@/components/form-kit";
import { fmt } from "@/lib/format";

type Location = { id: string; code: string; name: string; type: string; status: string; isDefault: boolean };

type LotAtLocation = {
  lotId: string; lotNo: string | null; qty: number; unitCost: number;
  expiryDate: string | null; receivedDate: string | null;
};
type ItemAtLocation = {
  itemId: string; qty: number; value: number; lots: LotAtLocation[];
  item: { id: string; name: string; code: string | null; baseUom: string | null; productType: string } | null;
};

type TransferRow = {
  id: string; transferNo: string | null; transferDate: string; status: string;
  totalCost: number; entryId: string | null; notes: string | null;
  fromLocation: { code: string; name: string } | null;
  toLocation: { code: string; name: string } | null;
};

type Line = { key: string; itemId: string; qtyBase: string; lotIds: string[]; description: string };

const newLine = (): Line => ({
  key: Math.random().toString(36).slice(2),
  itemId: "", qtyBase: "", lotIds: [], description: "",
});

const today = () => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD, never UTC

export function StockTransferConsole() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [toast, setToast] = useState<any>(null);

  const say = (message: string, type = "success") => setToast({ message, type });

  async function load() {
    setLoading(true);
    try {
      const [locRes, trRes] = await Promise.all([
        fetch("/api/inventory/locations"),
        fetch("/api/inventory/transfers"),
      ]);
      const locData = await locRes.json();
      const trData = await trRes.json();
      if (!locRes.ok) throw new Error(locData?.error || "Could not load locations");
      if (!trRes.ok) throw new Error(trData?.error || "Could not load transfers");
      setLocations((locData.locations ?? []).filter((l: Location) => l.status === "Active"));
      setRows(trData ?? []);
    } catch (e: any) {
      say(e.message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-stone-100 flex items-center gap-2">
            <ArrowLeftRight size={18} className="text-orange-400" /> Stock Transfers
          </h1>
          <p className="text-[13px] text-stone-400 mt-1">
            Move stock between locations. A transfer changes where stock is, never what it cost —
            the lot keeps its identity and its place in the FIFO queue.
          </p>
        </div>
        <Button
          icon={Plus}
          onClick={() => setComposing(true)}
          disabled={locations.length < 2}
          title={locations.length < 2 ? "You need at least two active locations to transfer between" : undefined}
        >
          New transfer
        </Button>
      </div>

      {locations.length < 2 && !loading && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Transfers need at least two active locations. Add another under{" "}
            <a href="/supply-chain/locations" className="underline hover:text-amber-200">Locations</a>.
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-stone-500 py-10 justify-center">
          <Loader2 size={15} className="animate-spin" /> Loading transfers…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No stock transfers yet"
          description="When stock moves between a store, the production floor or a finished-goods warehouse, record it here so the system knows where things are."
        />
      ) : (
        <Card padding="none">
          <table className="w-full text-[13px]">
            <thead className="border-b border-stone-800">
              <tr>
                <th className={th}>Number</th>
                <th className={th}>Date</th>
                <th className={th}>From</th>
                <th className={th}>To</th>
                <th className={`${th} text-right`}>Value moved</th>
                <th className={th}>Posted to GL</th>
                <th className={th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-stone-800/60 last:border-0 hover:bg-stone-900/40">
                  <td className="px-2.5 py-2.5 font-mono text-[12px] text-stone-300">{r.transferNo ?? "—"}</td>
                  <td className="px-2.5 py-2.5 text-stone-400">{fmt.date(r.transferDate)}</td>
                  <td className="px-2.5 py-2.5 text-stone-200">{r.fromLocation?.name ?? "—"}</td>
                  <td className="px-2.5 py-2.5 text-stone-200">{r.toLocation?.name ?? "—"}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-stone-300">{fmt.money(r.totalCost)}</td>
                  <td className="px-2.5 py-2.5">
                    {r.entryId
                      ? <Badge variant="blue" size="xs">Reclassified</Badge>
                      : <span className="text-stone-600 text-[12px]" title="Both locations post to the same inventory account, so nothing changed in the books">No GL impact</span>}
                  </td>
                  <td className="px-2.5 py-2.5 text-stone-500 truncate max-w-[220px]">{r.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {composing && (
        <TransferComposer
          locations={locations}
          onClose={() => setComposing(false)}
          onPosted={(msg) => { setComposing(false); say(msg); load(); }}
          onError={(msg) => say(msg, "error")}
        />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

function TransferComposer({
  locations, onClose, onPosted, onError,
}: {
  locations: Location[];
  onClose: () => void;
  onPosted: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const defaultFrom = locations.find(l => l.isDefault)?.id ?? locations[0]?.id ?? "";
  const [fromId, setFromId] = useState(defaultFrom);
  const [toId, setToId] = useState("");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [stock, setStock] = useState<ItemAtLocation[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lotPickerFor, setLotPickerFor] = useState<string | null>(null);

  // What is actually at the source. Reloaded whenever the source changes, and
  // the lines are cleared with it — a lot id from the previous location is
  // meaningless here and submitting one would just fail at the server.
  useEffect(() => {
    if (!fromId) { setStock([]); return; }
    let cancelled = false;
    setLoadingStock(true);
    fetch(`/api/inventory/locations/${fromId}/stock`)
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return;
        if (!ok) throw new Error(d?.error || "Could not read stock at that location");
        setStock(d ?? []);
        setLines([newLine()]);
      })
      .catch(e => !cancelled && onError(e.message))
      .finally(() => !cancelled && setLoadingStock(false));
    return () => { cancelled = true; };
  }, [fromId]);

  const stockByItem = useMemo(() => new Map(stock.map(s => [s.itemId, s])), [stock]);

  const availableFor = (line: Line): number => {
    const s = stockByItem.get(line.itemId);
    if (!s) return 0;
    if (!line.lotIds.length) return s.qty;
    return Math.round(s.lots.filter(l => line.lotIds.includes(l.lotId)).reduce((t, l) => t + l.qty, 0) * 1e4) / 1e4;
  };

  const lineError = (line: Line): string | null => {
    if (!line.itemId) return null;
    const qty = Number(line.qtyBase);
    if (!line.qtyBase) return null;
    if (!(qty > 0)) return "Enter a quantity greater than zero.";
    const avail = availableFor(line);
    if (qty > avail) return `Only ${avail.toLocaleString()} available${line.lotIds.length ? " in the selected lot(s)" : " here"}.`;
    return null;
  };

  const filled = lines.filter(l => l.itemId && Number(l.qtyBase) > 0);
  const anyLineError = lines.some(l => lineError(l));
  const sameLocation = !!fromId && fromId === toId;
  const canPost = !!fromId && !!toId && !sameLocation && filled.length > 0 && !anyLineError && !saving;

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));

  async function post() {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/inventory/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transferDate: date,
          fromLocationId: fromId,
          toLocationId: toId,
          notes: notes.trim() || null,
          lines: filled.map(l => ({
            itemId: l.itemId,
            qtyBase: Number(l.qtyBase),
            lotIds: l.lotIds.length ? l.lotIds : undefined,
            description: l.description.trim() || null,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not post the transfer");
      onPosted(`Transfer ${data.transferNo ?? ""} posted — ${data.lines} lot movement(s)`);
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const activeLine = lines.find(l => l.key === lotPickerFor) ?? null;
  const activeStock = activeLine ? stockByItem.get(activeLine.itemId) : null;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="New stock transfer"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={post} disabled={!canPost}>
              {saving ? "Posting…" : "Post transfer"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[12px] text-rose-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <Section title="Movement">
            <div className="grid grid-cols-3 gap-3">
              <Field label="From" required>
                <SelectField value={fromId} onChange={e => setFromId(e.target.value)}>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}
                </SelectField>
              </Field>
              <Field
                label="To"
                required
                error={sameLocation ? "Pick a different destination — nothing would move." : undefined}
              >
                <SelectField value={toId} onChange={e => setToId(e.target.value)}>
                  <option value="">Choose a destination…</option>
                  {locations.filter(l => l.id !== fromId).map(l => (
                    <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
                  ))}
                </SelectField>
              </Field>
              <Field label="Date" required>
                <input type="date" className={control} value={date} onChange={e => setDate(e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section
            title="What is moving"
            desc={
              loadingStock ? "Reading what is at the source location…"
                : stock.length === 0 ? "There is no stock at the source location."
                : `${stock.length} item(s) available to move.`
            }
            right={
              <Button variant="ghost" size="sm" icon={Plus} onClick={() => setLines(ls => [...ls, newLine()])} disabled={stock.length === 0}>
                Add line
              </Button>
            }
          >
            {loadingStock ? (
              <div className="flex items-center gap-2 text-[12px] text-stone-500 py-6 justify-center">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : stock.length === 0 ? (
              <div className="flex items-center gap-2 text-[12px] text-stone-500 py-6 justify-center">
                <PackageSearch size={14} /> Nothing is currently held at that location.
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-stone-800">
                    <th className={th}>Item</th>
                    <th className={`${th} text-right w-28`}>Available</th>
                    <th className={`${th} text-right w-28`}>Move</th>
                    <th className={th}>Lots</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map(line => {
                    const s = stockByItem.get(line.itemId);
                    const errText = lineError(line);
                    return (
                      <tr key={line.key} className="border-b border-stone-800/60 last:border-0 align-top">
                        <td className="px-1.5 py-2">
                          <select
                            className={cell}
                            value={line.itemId}
                            onChange={e => setLine(line.key, { itemId: e.target.value, lotIds: [], qtyBase: "" })}
                          >
                            <option value="">Choose an item…</option>
                            {stock.map(st => (
                              <option key={st.itemId} value={st.itemId}>
                                {st.item?.name ?? st.itemId}{st.item?.code ? ` (${st.item.code})` : ""}
                              </option>
                            ))}
                          </select>
                          {line.itemId && (
                            <input
                              className={`${cell} mt-1 text-stone-500`}
                              placeholder="Note (optional)"
                              value={line.description}
                              onChange={e => setLine(line.key, { description: e.target.value })}
                            />
                          )}
                        </td>
                        <td className="px-1.5 py-2 text-right tabular-nums text-[12px] text-stone-400">
                          {s ? (
                            <>
                              {availableFor(line).toLocaleString()}
                              {s.item?.baseUom && <span className="text-stone-600 ml-1">{s.item.baseUom}</span>}
                            </>
                          ) : "—"}
                        </td>
                        <td className="px-1.5 py-2">
                          <input
                            className={`${cell} text-right tabular-nums ${errText ? "ring-1 ring-rose-500/50" : ""}`}
                            inputMode="decimal"
                            value={line.qtyBase}
                            onChange={e => setLine(line.key, { qtyBase: e.target.value })}
                            disabled={!line.itemId}
                            placeholder="0"
                          />
                          {errText && <p className="mt-1 text-[10px] text-rose-400 text-right">{errText}</p>}
                        </td>
                        <td className="px-1.5 py-2">
                          {line.itemId ? (
                            <button
                              onClick={() => setLotPickerFor(line.key)}
                              className="text-[12px] text-stone-400 hover:text-stone-200 underline decoration-stone-700 underline-offset-2"
                            >
                              {line.lotIds.length
                                ? `${line.lotIds.length} lot(s) chosen`
                                : "FIFO (oldest first)"}
                            </button>
                          ) : <span className="text-stone-600 text-[12px]">—</span>}
                        </td>
                        <td className="px-1.5 py-2">
                          {lines.length > 1 && (
                            <button
                              onClick={() => setLines(ls => ls.filter(l => l.key !== line.key))}
                              className="p-1 rounded text-stone-600 hover:text-rose-400"
                              title="Remove line"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>

          <Field label="Notes">
            <textarea className={control} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </Field>
        </div>
      </Modal>

      {/* Lot picker — specific identification, which is what this business
          costs on. Blank means FIFO chooses. */}
      {activeLine && activeStock && (
        <Modal
          open
          onClose={() => setLotPickerFor(null)}
          title={`Choose lots — ${activeStock.item?.name ?? ""}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setLine(activeLine.key, { lotIds: [] })}>
                Clear (use FIFO)
              </Button>
              <Button onClick={() => setLotPickerFor(null)}>Done</Button>
            </>
          }
        >
          <p className="text-[12px] text-stone-500 mb-3">
            Leave everything unticked to let FIFO take the oldest stock first. Tick specific lots
            when the boxes being carried are particular ones — the cost follows the lot.
          </p>
          <div className="space-y-1 max-h-80 overflow-auto">
            {activeStock.lots.map(lot => {
              const on = activeLine.lotIds.includes(lot.lotId);
              return (
                <label
                  key={lot.lotId}
                  className={`flex items-center gap-3 px-2.5 py-2 rounded-md cursor-pointer border ${
                    on ? "border-emerald-500/40 bg-emerald-500/10" : "border-transparent hover:bg-stone-800/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    className="accent-emerald-500"
                    onChange={() =>
                      setLine(activeLine.key, {
                        lotIds: on
                          ? activeLine.lotIds.filter(id => id !== lot.lotId)
                          : [...activeLine.lotIds, lot.lotId],
                        qtyBase: "",
                      })
                    }
                  />
                  <span className="font-mono text-[12px] text-stone-300 flex-1">{lot.lotNo ?? "(no lot no)"}</span>
                  <span className="text-[12px] tabular-nums text-stone-400">{lot.qty.toLocaleString()}</span>
                  <span className="text-[11px] tabular-nums text-stone-600 w-24 text-right">
                    @ {fmt.money(lot.unitCost)}
                  </span>
                  <span className="text-[11px] text-stone-600 w-24 text-right">
                    {lot.receivedDate ? fmt.shortDate(lot.receivedDate) : "—"}
                  </span>
                </label>
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}
