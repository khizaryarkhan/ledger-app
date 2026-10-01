"use client";

/**
 * Work Centres — where production work is done, and what an hour of it costs.
 * A BOM's operations say how many hours a batch takes at a centre; an MO
 * copies those hours and these rates when it is planned, and each completion
 * charges hours × rate into the output's cost (Labour / Overhead absorbed).
 */

import { useEffect, useMemo, useState } from "react";
import { Factory, Plus, RefreshCw } from "lucide-react";
import {
  useListView, ListPage, ListPageHeader, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  listTable, listRow, listNumCell, type ListColumn,
} from "@/components/list-view";
import { Button, Toast } from "@/components/ui";
import { Drawer, DrawerFooter, Field, SelectField, controlInset, t } from "@/components/form-kit";
import { fmt } from "@/lib/format";
import { useData } from "@/components/data-provider";

type WC = { id: string; code: string | null; name: string; labourRate: number; overheadRate: number; status: string };

export function WorkCentreRegister() {
  const { orgSettings } = useData() as any;
  const ccy = orgSettings?.currency ?? "EUR";
  const [rows, setRows] = useState<WC[] | null>(null);
  const [edit, setEdit] = useState<WC | "new" | null>(null);
  const [toast, setToast] = useState<any>(null);
  async function load() {
    const r = await fetch("/api/production/work-centres");
    const d = await r.json().catch(() => []);
    setRows(Array.isArray(d) ? d : []);
  }
  useEffect(() => { load(); }, []);

  const listRows = rows ?? [];
  const WC_COLS = useMemo<ListColumn<WC>[]>(() => [
    { key: "name", label: "Work centre", sort: r => r.name, filter: { kind: "text", value: r => r.name } },
    { key: "code", label: "Code", sort: r => r.code, filter: { kind: "text", value: r => r.code } },
    { key: "labourRate", label: "Labour / hour", align: "right", sort: r => r.labourRate },
    { key: "overheadRate", label: "Overhead / hour", align: "right", sort: r => r.overheadRate },
    { key: "totalRate", label: "Total / hour", align: "right", sort: r => r.labourRate + r.overheadRate, descFirst: true },
    { key: "status", label: "Status", sort: r => r.status, filter: { kind: "multi", value: r => r.status } },
  ], []);
  const lv = useListView(listRows, WC_COLS, { storageKey: "work-centres", defaultSort: "name" });

  return (
    <ListPage>
      <ListPageHeader title="Work Centres" subtitle="Where production work is done and what an hour of it costs. BOM operations charge these rates into the output's cost.">
        <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
        <Button icon={Plus} onClick={() => setEdit("new")}>New work centre</Button>
      </ListPageHeader>

      {rows === null ? (
        <p className="px-4 py-8 text-center text-[13px] text-stone-500">Loading…</p>
      ) : (
        <>
          <ListToolbar lv={lv} noun="work centre" plural="work centres" />
          <ListChips lv={lv} />
          <ListScroll lv={lv} empty={listRows.length === 0
            ? "No work centres yet. Add one — a sewing line, a cutting table, a dye house — with its hourly rates."
            : "No work centres match the current filters."}>
            <table className={listTable}>
              <ListHead lv={lv} />
              <tbody>
                {lv.rows.map(r => (
                  <tr key={r.id} onClick={() => setEdit(r)} className={`${listRow()} cursor-pointer`}>
                    <td className="px-2 py-2 text-stone-100 font-medium">{r.name}</td>
                    <td className="px-2 py-2 font-mono text-[12px] text-stone-400">{r.code || "—"}</td>
                    <td className={`${listNumCell} text-stone-300`}>{fmt.money(r.labourRate, ccy)}</td>
                    <td className={`${listNumCell} text-stone-300`}>{fmt.money(r.overheadRate, ccy)}</td>
                    <td className={`${listNumCell} text-stone-100`}>{fmt.money(r.labourRate + r.overheadRate, ccy)}</td>
                    <td className="px-2 py-2 text-stone-400">{r.status}</td>
                  </tr>
                ))}
              </tbody>
              {lv.rows.length > 0 && <ListFoot lv={lv} noun="work centre" plural="work centres" />}
            </table>
          </ListScroll>
        </>
      )}

      {edit && <WorkCentreDrawer wc={edit === "new" ? null : edit} onClose={() => setEdit(null)}
        onSaved={msg => { setEdit(null); load(); setToast({ message: msg, type: "success" }); }} />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </ListPage>
  );
}

function WorkCentreDrawer({ wc, onClose, onSaved }: { wc: WC | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [f, setF] = useState({ name: wc?.name ?? "", code: wc?.code ?? "", labourRate: String(wc?.labourRate ?? ""), overheadRate: String(wc?.overheadRate ?? ""), status: wc?.status ?? "Active" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));
  async function save() {
    setSaving(true); setErr(null);
    const r = await fetch(wc ? `/api/production/work-centres/${wc.id}` : "/api/production/work-centres", {
      method: wc ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, labourRate: f.labourRate || 0, overheadRate: f.overheadRate || 0 }),
    });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { setErr(d?.error || "Could not save."); return; }
    onSaved(wc ? "Work centre updated" : "Work centre created");
  }
  async function remove() {
    if (!wc || !confirm(`Delete "${wc.name}"?`)) return;
    const r = await fetch(`/api/production/work-centres/${wc.id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(d?.error || "Could not delete."); return; }
    onSaved("Work centre deleted");
  }
  return (
    <Drawer title={wc ? `Edit ${wc.name}` : "New work centre"} onClose={onClose}
      footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel={wc ? "Save" : "Create"} err={err} saveDisabled={!f.name.trim()}
        extra={wc ? <button onClick={remove} className="text-[12px] text-stone-500 hover:text-rose-400">Delete</button> : undefined} />}>
      <div className="space-y-4">
        <Field label="Name" required hint="e.g. Sewing line 1, Cutting table, Dye house">
          <input className={controlInset} value={f.name} onChange={e => set("name", e.target.value)} autoFocus />
        </Field>
        <Field label="Code"><input className={controlInset} value={f.code} onChange={e => set("code", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Labour rate per hour" hint="Wages charged into production.">
            <input type="number" min="0" step="any" className={controlInset} value={f.labourRate} onChange={e => set("labourRate", e.target.value)} />
          </Field>
          <Field label="Overhead rate per hour" hint="Power, rent, depreciation of the line.">
            <input type="number" min="0" step="any" className={controlInset} value={f.overheadRate} onChange={e => set("overheadRate", e.target.value)} />
          </Field>
        </div>
        {wc && (
          <Field label="Status" hint="Inactive centres can't be added to a BOM.">
            <SelectField inset value={f.status} onChange={e => set("status", e.target.value)}><option>Active</option><option>Inactive</option></SelectField>
          </Field>
        )}
        <p className={t.hint}>A rate change applies to orders planned after it. An order already planned keeps the rates it was costed at.</p>
      </div>
    </Drawer>
  );
}
