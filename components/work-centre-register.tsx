"use client";

/**
 * Work Centres — where production work is done, and what an hour of it costs.
 * A BOM's operations say how many hours a batch takes at a centre; an MO
 * copies those hours and these rates when it is planned, and each completion
 * charges hours × rate into the output's cost (Labour / Overhead absorbed).
 */

import { useEffect, useState } from "react";
import { Factory, Plus, RefreshCw } from "lucide-react";
import { ListPage, ListPageHeader } from "@/components/list-view";
import { Button, Toast } from "@/components/ui";
import { Drawer, DrawerFooter, Field, SelectField, controlInset, t, tableHead } from "@/components/form-kit";
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

  return (
    <ListPage>
      <ListPageHeader title="Work Centres" subtitle="Where production work is done and what an hour of it costs. BOM operations charge these rates into the output's cost.">
        <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
        <Button icon={Plus} onClick={() => setEdit("new")}>New work centre</Button>
      </ListPageHeader>
      <div className="flex-1 overflow-auto p-6">
        <div className="rounded-lg border border-stone-800 overflow-hidden max-w-4xl">
          <table className="w-full text-[13px]">
            <thead><tr className={tableHead}>
              <th className="text-left px-4 py-2.5">Work centre</th><th className="text-left px-4 py-2.5">Code</th>
              <th className="text-right px-4 py-2.5">Labour / hour</th><th className="text-right px-4 py-2.5">Overhead / hour</th>
              <th className="text-right px-4 py-2.5">Total / hour</th><th className="text-left px-4 py-2.5">Status</th>
            </tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {rows?.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-stone-500">
                  <Factory size={20} className="mx-auto mb-2 text-stone-600" />
                  No work centres yet. Add one — a sewing line, a cutting table, a dye house — with its hourly rates.
                </td></tr>
              )}
              {rows?.map(r => (
                <tr key={r.id} onClick={() => setEdit(r)} className="border-b border-stone-800/60 cursor-pointer hover:bg-stone-900/60">
                  <td className="px-4 py-2 text-stone-100 font-medium">{r.name}</td>
                  <td className="px-4 py-2 font-mono text-[12px] text-stone-400">{r.code || "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-stone-300">{fmt.money(r.labourRate, ccy)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-stone-300">{fmt.money(r.overheadRate, ccy)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-stone-100">{fmt.money(r.labourRate + r.overheadRate, ccy)}</td>
                  <td className="px-4 py-2 text-stone-400">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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
