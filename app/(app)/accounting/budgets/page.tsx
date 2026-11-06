"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search, Trash2, Archive, ArrowLeft, Save, Loader } from "lucide-react";
import { ListPage, ListPageHeader, listTable, listRow, listCell, listNumCell } from "@/components/list-view";
import { Drawer, DrawerFooter, Field, CalcInput, SelectField, control, controlInset, controlCompactIcon, cell } from "@/components/form-kit";
import { fmt } from "@/lib/format";
import { MONTH_LABELS, isBudgetableAccount, accountKind, parseAmount, rowTotal } from "@/lib/accounting/budgets";

type BudgetRow = { id: string; name: string; year: number; status: string; lineCount: number };
type Acct = { id: string; name: string; code: string | null; type: string | null; classification: string | null; status?: string; isHeader?: boolean };
type Grid = Record<string, Record<number, string>>;

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const thisYear = () => Number(new Date().toISOString().slice(0, 4));

export default function BudgetsPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  return openId ? <Editor id={openId} onBack={() => setOpenId(null)} /> : <BudgetList onOpen={setOpenId} />;
}

function BudgetList({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/accounting/budgets");
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Could not load budgets");
      setRows(d);
      setErr(null);
    } catch (e: any) { setErr(e?.message || "Could not load budgets"); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setStatus(b: BudgetRow) {
    await fetch(`/api/accounting/budgets/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: b.status === "active" ? "archived" : "active" }) });
    load();
  }
  async function remove(b: BudgetRow) {
    if (!confirm(`Delete budget "${b.name}"? This cannot be undone.`)) return;
    await fetch(`/api/accounting/budgets/${b.id}`, { method: "DELETE" });
    load();
  }

  return (
    <ListPage>
      <ListPageHeader title="Budgets" subtitle="Plan income and expenses by account and month, then compare to actuals.">
        <Link href="/accounting/reports/budget-vs-actual" className="h-8 px-3 inline-flex items-center text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 hover:text-stone-100">Budget vs actual</Link>
        <button onClick={() => setCreating(true)} className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-white hover:bg-primary-hover"><Plus size={13} /> New budget</button>
      </ListPageHeader>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {err && <p className="text-sm text-rose-400 mb-3">{err}</p>}
        {loading ? <p className="text-sm text-stone-500">Loading…</p> : rows.length === 0 ? (
          <div className="rounded-xl bg-stone-900 border border-stone-800 p-8 text-center text-sm text-stone-500">No budgets yet. Create one to start planning.</div>
        ) : (
          <table className={listTable}>
            <thead><tr className="text-[11px] font-medium text-stone-500 border-b border-stone-800">
              <th className="text-left px-2 py-2">Name</th><th className="text-left px-2 py-2">Year</th>
              <th className="text-left px-2 py-2">Status</th><th className="text-right px-2 py-2">Cells</th><th className="w-24" />
            </tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className={`${listRow()} cursor-pointer`} onClick={() => onOpen(b.id)}>
                  <td className={`${listCell} text-stone-100`}>{b.name}</td>
                  <td className={`${listCell} text-stone-300`}>{b.year}</td>
                  <td className={`${listCell} text-stone-400`}>{b.status === "archived" ? "Archived" : "Active"}</td>
                  <td className={listNumCell}>{b.lineCount}</td>
                  <td className={`${listCell} text-right`} onClick={(e) => e.stopPropagation()}>
                    <button title={b.status === "active" ? "Archive" : "Restore"} onClick={() => setStatus(b)} className="p-1.5 rounded hover:bg-stone-800 text-stone-500"><Archive size={14} /></button>
                    <button title="Delete" onClick={() => remove(b)} className="p-1.5 rounded hover:bg-stone-800 text-stone-500"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {creating && <NewBudgetDrawer onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); onOpen(id); }} />}
    </ListPage>
  );
}

function NewBudgetDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [year, setYear] = useState(String(thisYear()));
  const [copy, setCopy] = useState(false);
  const [uplift, setUplift] = useState("0");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const r = await fetch("/api/accounting/budgets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, year: Number(year), copyFromPriorYear: copy, uplift: copy ? parseAmount(uplift) : undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Could not create budget");
      onCreated(d.id);
    } catch (e: any) { setErr(e?.message || "Could not create budget"); } finally { setSaving(false); }
  }

  return (
    <Drawer title="New budget" subtitle="A named plan for one calendar year" onClose={onClose}
      footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Create budget" err={err} saveDisabled={!name.trim() || !/^\d{4}$/.test(year)} />}>
      <div className="space-y-4">
        <Field label="Name"><input className={controlInset} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. FY2027 Operating budget" autoFocus /></Field>
        <Field label="Year"><input className={controlInset} inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} /></Field>
        <label className="flex items-start gap-2 text-[13px] text-stone-300 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
          <span>Start from last year&apos;s actuals<span className="block text-[12px] text-stone-500">Seeds every account and month from the posted ledger of the prior year.</span></span>
        </label>
        {copy && <Field label="Uplift %" hint="Applied to every seeded amount. Use 0 to copy as is."><input className={controlInset} inputMode="decimal" value={uplift} onChange={(e) => setUplift(e.target.value)} /></Field>}
      </div>
    </Drawer>
  );
}

function Editor({ id, onBack }: { id: string; onBack: () => void }) {
  const [meta, setMeta] = useState<{ name: string; year: number } | null>(null);
  const [accts, setAccts] = useState<Acct[]>([]);
  const [grid, setGrid] = useState<Grid>({});
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [b, a] = await Promise.all([
          fetch(`/api/accounting/budgets/${id}`).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d?.error || "Could not load budget"); return d; }),
          fetch("/api/accounting/accounts").then((r) => r.json()),
        ]);
        setMeta({ name: b.name, year: b.year });
        const list: Acct[] = (Array.isArray(a) ? a : []).filter((x: Acct) => isBudgetableAccount(x) && (x.status ?? "Active") === "Active");
        const g: Grid = {};
        for (const l of b.lines as { accountId: string; month: number; amount: number }[]) (g[l.accountId] ??= {})[l.month] = String(l.amount);
        setAccts(list.sort((x, y) => (x.code ?? "").localeCompare(y.code ?? "") || x.name.localeCompare(y.name)));
        setGrid(g);
      } catch (e: any) { setLoadErr(e?.message || "Could not load budget"); }
    })();
  }, [id]);

  const setCell = (acct: string, m: number, v: string) => setGrid((g) => ({ ...g, [acct]: { ...(g[acct] ?? {}), [m]: v } }));
  const numeric = (acct: string): Record<number, number> => Object.fromEntries(MONTHS.map((m) => [m, parseAmount(grid[acct]?.[m])]));

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return accts.filter((a) => !s || a.name.toLowerCase().includes(s) || (a.code ?? "").toLowerCase().includes(s));
  }, [accts, q]);

  const colTotals = useMemo(() => {
    const t = { income: {} as Record<number, number>, expense: {} as Record<number, number> };
    for (const a of accts) {
      const k = accountKind(a.type, a.classification);
      for (const m of MONTHS) t[k][m] = (t[k][m] ?? 0) + parseAmount(grid[a.id]?.[m]);
    }
    return t;
  }, [accts, grid]);

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const lines = accts.flatMap((a) => MONTHS.map((m) => ({ accountId: a.id, month: m, amount: parseAmount(grid[a.id]?.[m]) })));
      const r = await fetch(`/api/accounting/budgets/${id}/lines`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Could not save");
      setMsg({ ok: true, text: "Saved" });
    } catch (e: any) { setMsg({ ok: false, text: e?.message || "Could not save" }); } finally { setSaving(false); }
  }

  return (
    <ListPage>
      <ListPageHeader title={meta?.name ?? "Budget"} subtitle={meta ? `Calendar year ${meta.year} — amounts in the home currency, income and expenses both entered as positive figures.` : undefined}>
        <button onClick={onBack} className="h-8 px-3 inline-flex items-center gap-1.5 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 hover:text-stone-100"><ArrowLeft size={13} /> All budgets</button>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-500" />
          <input className={`${controlCompactIcon} w-52`} placeholder="Find account…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {msg && <span className={`text-xs ${msg.ok ? "text-stone-400" : "text-rose-400"}`}>{msg.text}</span>}
        <button onClick={save} disabled={saving || !meta} className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-white hover:bg-primary-hover disabled:opacity-60">
          {saving ? <Loader size={13} className="animate-spin" /> : <Save size={13} />} Save budget
        </button>
      </ListPageHeader>
      <div className="flex-1 overflow-auto px-6 py-4">
        {loadErr ? <p className="text-sm text-rose-400">{loadErr}</p> : !meta ? <p className="text-sm text-stone-500">Loading…</p> : accts.length === 0 ? (
          <p className="text-sm text-stone-500">No Profit &amp; Loss accounts in the chart of accounts yet.</p>
        ) : (
          <table className={`${listTable} min-w-[1400px]`}>
            <thead className="sticky top-0 bg-stone-950 z-10">
              <tr className="text-[11px] font-medium text-stone-500 border-b border-stone-800">
                <th className="text-left px-2 py-2 min-w-[240px] sticky left-0 bg-stone-950">Account</th>
                {MONTHS.map((m) => <th key={m} className="text-right px-1 py-2 w-24">{MONTH_LABELS[m - 1]}</th>)}
                <th className="text-right px-2 py-2 w-28">Total</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id} className={listRow()}>
                  <td className={`${listCell} sticky left-0 bg-stone-950 text-stone-200`}>{a.code ? <span className="text-stone-500 mr-1.5">{a.code}</span> : null}{a.name}</td>
                  {MONTHS.map((m) => (
                    <td key={m} className="px-0.5 py-0.5">
                      <CalcInput value={grid[a.id]?.[m] ?? ""} onChange={(v) => setCell(a.id, m, v)} className={`${cell} text-right tabular-nums`} aria-label={`${a.name} ${MONTH_LABELS[m - 1]}`} />
                    </td>
                  ))}
                  <td className={`${listNumCell} text-stone-300`}>{fmt.num2(rowTotal(numeric(a.id)))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {(["income", "expense"] as const).map((k) => (
                <tr key={k} className="border-t border-stone-800 text-[12px] text-stone-400">
                  <td className="px-2 py-2 sticky left-0 bg-stone-950">{k === "income" ? "Total income" : "Total expenses"}</td>
                  {MONTHS.map((m) => <td key={m} className={listNumCell}>{fmt.num2(colTotals[k][m] ?? 0)}</td>)}
                  <td className={listNumCell}>{fmt.num2(rowTotal(colTotals[k]))}</td>
                </tr>
              ))}
              <tr className="border-t border-stone-700 text-[12px] font-semibold text-stone-200">
                <td className="px-2 py-2 sticky left-0 bg-stone-950">Budgeted profit</td>
                {MONTHS.map((m) => <td key={m} className={listNumCell}>{fmt.num2((colTotals.income[m] ?? 0) - (colTotals.expense[m] ?? 0))}</td>)}
                <td className={listNumCell}>{fmt.num2(rowTotal(colTotals.income) - rowTotal(colTotals.expense))}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </ListPage>
  );
}
