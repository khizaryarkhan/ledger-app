"use client";

/**
 * Fixed assets register (straight-line). Rules live in lib/accounting/fixed-assets.ts;
 * posting lives behind /api/accounting/fixed-assets/depreciate.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Play } from "lucide-react";
import { ListPage, ListPageHeader } from "@/components/list-view";
import { Drawer, DrawerFooter, Field, SelectField, controlInset, tableHead } from "@/components/form-kit";
import { fmt, formatDate, localToday } from "@/lib/format";

type Asset = {
  id: string; code: string | null; name: string; purchaseDate: string;
  cost: string; salvageValue: string; usefulLifeMonths: number;
  status: string; disposedDate: string | null; notes: string | null;
  accumulated: number; netBookValue: number; postedPeriods: number; schedulePeriods: number;
  assetAccountId: string; accumDepAccountId: string; depreciationExpenseAccountId: string;
};
type Acct = { id: string; name: string; code?: string | null; type?: string | null; status?: string; isHeader?: boolean };
type SchedRow = { period: string; amount: number; accumulated: number; netBookValue: number; posted: boolean; cancelled: boolean };
type Planned = { assetId: string; assetName: string; period: string; date: string; amount: number; blocked: string | null };

const th = tableHead + " px-3 py-2.5 text-left";
const num = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || "Request failed");
  return j;
}

export default function FixedAssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [accts, setAccts] = useState<Acct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<"new" | "run" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, a] = await Promise.all([
        call("/api/accounting/fixed-assets", "GET"),
        fetch("/api/accounting/accounts").then(x => x.json()).catch(() => []),
      ]);
      setAssets(r.assets ?? []);
      setAccts(Array.isArray(a) ? a : []);
      setLoadErr(null);
    } catch (e: any) { setLoadErr(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => assets.reduce(
    (s, a) => ({ cost: s.cost + Number(a.cost), acc: s.acc + a.accumulated, nbv: s.nbv + a.netBookValue }),
    { cost: 0, acc: 0, nbv: 0 }), [assets]);

  return (
    <ListPage>
      <ListPageHeader title="Fixed assets" subtitle="Straight-line depreciation, posted to the ledger monthly">
        <button onClick={() => setDrawer("run")}
          className="h-8 px-3 rounded-md text-[12px] font-medium ring-1 ring-stone-700 bg-stone-800 text-stone-200 hover:bg-stone-700 flex items-center gap-1.5">
          <Play size={13} /> Run depreciation
        </button>
        <button onClick={() => setDrawer("new")}
          className="h-8 px-3 rounded-md text-[12px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1.5">
          <Plus size={13} /> New asset
        </button>
      </ListPageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loadErr && <p className="text-[13px] text-rose-400 mb-3">{loadErr}</p>}
        {loading ? <p className="text-[13px] text-stone-500">Loading...</p> : assets.length === 0 ? (
          <p className="text-[13px] text-stone-500">No fixed assets yet. Add one to start depreciating it.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead><tr>
              <th className={th}>Asset</th><th className={th}>Purchased</th>
              <th className={th + " text-right"}>Cost</th><th className={th + " text-right"}>Accumulated</th>
              <th className={th + " text-right"}>Net book value</th><th className={th}>Status</th>
            </tr></thead>
            <tbody>
              {assets.map(a => (
                <tr key={a.id} onClick={() => setOpenId(a.id)} className="border-b border-stone-800/70 hover:bg-stone-900 cursor-pointer">
                  <td className="px-3 py-2 text-stone-100">{a.name}{a.code && <span className="ml-2 text-[11px] text-stone-500">{a.code}</span>}</td>
                  <td className="px-3 py-2 text-stone-400">{formatDate(a.purchaseDate)}</td>
                  <td className={num}>{fmt.num2(Number(a.cost))}</td>
                  <td className={num}>{fmt.num2(a.accumulated)}</td>
                  <td className={num + " text-stone-100"}>{fmt.num2(a.netBookValue)}</td>
                  <td className="px-3 py-2 text-stone-400">
                    {a.status === "disposed" ? `Disposed ${a.disposedDate ? formatDate(a.disposedDate) : ""}` : "Active"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-stone-700 text-stone-200">
              <td className="px-3 py-2 font-medium" colSpan={2}>Total</td>
              <td className={num}>{fmt.num2(totals.cost)}</td>
              <td className={num}>{fmt.num2(totals.acc)}</td>
              <td className={num}>{fmt.num2(totals.nbv)}</td><td />
            </tr></tfoot>
          </table>
        )}
      </div>

      {drawer === "new" && <NewAssetDrawer accts={accts} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); load(); }} />}
      {drawer === "run" && <RunDrawer onClose={() => setDrawer(null)} onDone={load} />}
      {openId && <AssetDrawer id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </ListPage>
  );
}

function acctLabel(a: Acct) { return `${a.code ? a.code + " " : ""}${a.name}`; }

function NewAssetDrawer({ accts, onClose, onDone }: { accts: Acct[]; onClose: () => void; onDone: () => void }) {
  const usable = (a: Acct) => !a.isHeader && (a.status ?? "Active") === "Active";
  const fixed = accts.filter(a => usable(a) && a.type === "Fixed Asset");
  const expense = accts.filter(a => usable(a) && a.type === "Expense");
  const [f, setF] = useState({
    name: "", code: "", purchaseDate: localToday(), cost: "", salvageValue: "", usefulLifeMonths: "60",
    assetAccountId: "", accumDepAccountId: "", depreciationExpenseAccountId: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }));

  async function save() {
    setSaving(true); setErr(null);
    try { await call("/api/accounting/fixed-assets", "POST", f); onDone(); }
    catch (e: any) { setErr(e.message); setSaving(false); }
  }

  return (
    <Drawer title="New fixed asset" onClose={onClose}
      footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Create asset" err={err} />}>
      <div className="space-y-4">
        <Field label="Name" required><input className={controlInset} value={f.name} onChange={set("name")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code"><input className={controlInset} value={f.code} onChange={set("code")} /></Field>
          <Field label="Purchase date" required><input type="date" className={controlInset} value={f.purchaseDate} onChange={set("purchaseDate")} /></Field>
          <Field label="Cost" required><input inputMode="decimal" className={controlInset} value={f.cost} onChange={set("cost")} /></Field>
          <Field label="Salvage value"><input inputMode="decimal" className={controlInset} value={f.salvageValue} onChange={set("salvageValue")} /></Field>
        </div>
        <Field label="Useful life (months)" required hint="Depreciation starts in the month of purchase.">
          <input inputMode="numeric" className={controlInset} value={f.usefulLifeMonths} onChange={set("usefulLifeMonths")} />
        </Field>
        <Field label="Asset account" required>
          <SelectField inset value={f.assetAccountId} onChange={set("assetAccountId")}>
            <option value="">Choose...</option>{fixed.map(a => <option key={a.id} value={a.id}>{acctLabel(a)}</option>)}
          </SelectField>
        </Field>
        <Field label="Accumulated depreciation account" required>
          <SelectField inset value={f.accumDepAccountId} onChange={set("accumDepAccountId")}>
            <option value="">Choose...</option>{fixed.map(a => <option key={a.id} value={a.id}>{acctLabel(a)}</option>)}
          </SelectField>
        </Field>
        <Field label="Depreciation expense account" required>
          <SelectField inset value={f.depreciationExpenseAccountId} onChange={set("depreciationExpenseAccountId")}>
            <option value="">Choose...</option>{expense.map(a => <option key={a.id} value={a.id}>{acctLabel(a)}</option>)}
          </SelectField>
        </Field>
        <Field label="Notes"><textarea className={controlInset} rows={3} value={f.notes} onChange={set("notes")} /></Field>
      </div>
    </Drawer>
  );
}

function AssetDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ asset: Asset; schedule: SchedRow[] } | null>(null);
  const [disposeDate, setDisposeDate] = useState(localToday());
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => call(`/api/accounting/fixed-assets/${id}`, "GET").then(setData).catch(e => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  async function dispose() {
    setSaving(true); setErr(null);
    try { await call(`/api/accounting/fixed-assets/${id}`, "PATCH", { dispose: { date: disposeDate } }); setConfirming(false); await load(); onChanged(); }
    catch (e: any) { setErr(e.message); }
    setSaving(false);
  }

  const a = data?.asset;
  return (
    <Drawer title={a?.name ?? "Fixed asset"} size="xl" onClose={onClose}
      subtitle={a ? `Cost ${fmt.num2(Number(a.cost))} · salvage ${fmt.num2(Number(a.salvageValue))} · ${a.usefulLifeMonths} months` : undefined}
      footer={a && a.status === "active" ? (
        confirming ? (
          <div className="flex items-center gap-2">
            <input type="date" className={controlInset + " max-w-[170px]"} value={disposeDate} onChange={e => setDisposeDate(e.target.value)} />
            <p className="flex-1 text-[12px] text-rose-400">{err}</p>
            <button onClick={() => setConfirming(false)} className="text-[13px] text-stone-300 px-3 py-2 rounded-lg hover:bg-stone-800">Cancel</button>
            <button onClick={dispose} disabled={saving} className="text-[13px] font-semibold bg-rose-600 text-white rounded-lg px-4 py-2 hover:bg-rose-700 disabled:opacity-60">Confirm disposal</button>
          </div>
        ) : (
          <div className="flex justify-between items-center">
            <p className="text-[12px] text-stone-500">Disposal stops depreciation from its month. It posts no entry.</p>
            <button onClick={() => setConfirming(true)} className="text-[13px] font-medium text-rose-300 px-3.5 py-2 rounded-lg hover:bg-stone-800">Dispose...</button>
          </div>
        )
      ) : undefined}>
      {err && !confirming && <p className="text-[12px] text-rose-400 mb-3">{err}</p>}
      {!data ? <p className="text-[13px] text-stone-500">Loading...</p> : (
        <table className="w-full text-[13px]">
          <thead><tr><th className={th}>Month</th><th className={th + " text-right"}>Charge</th>
            <th className={th + " text-right"}>Accumulated</th><th className={th + " text-right"}>NBV</th><th className={th}>Posted</th></tr></thead>
          <tbody>
            {data.schedule.map(r => (
              <tr key={r.period} className={"border-b border-stone-800/70 " + (r.cancelled ? "opacity-40" : "")}>
                <td className="px-3 py-1.5 text-stone-300">{r.period}</td>
                <td className={num}>{fmt.num2(r.amount)}</td>
                <td className={num}>{fmt.num2(r.accumulated)}</td>
                <td className={num}>{fmt.num2(r.netBookValue)}</td>
                <td className="px-3 py-1.5 text-stone-400">{r.cancelled ? "Not charged" : r.posted ? "Posted" : "Pending"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Drawer>
  );
}

function RunDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [through, setThrough] = useState(localToday().slice(0, 7));
  const [plan, setPlan] = useState<{ count: number; total: number; blocked: number; plan: Planned[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function preview() {
    setBusy(true); setErr(null); setPlan(null);
    try { setPlan(await call("/api/accounting/fixed-assets/depreciate?preview=1", "POST", { through })); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  async function post() {
    setBusy(true); setErr(null);
    try {
      const r = await call("/api/accounting/fixed-assets/depreciate", "POST", { through });
      setResult(`Posted ${r.posted} entr${r.posted === 1 ? "y" : "ies"} totalling ${fmt.num2(r.total)}.`);
      onDone();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <Drawer title="Run depreciation" size="lg" onClose={onClose}
      subtitle="Posts every unposted month up to and including the chosen month"
      footer={<DrawerFooter saving={busy} onClose={onClose} onSave={post} saveLabel="Post depreciation" err={err}
        pendingMsg={result ?? undefined} saveDisabled={!plan || plan.count === 0 || plan.blocked > 0} />}>
      <div className="flex items-end gap-2 mb-4">
        <Field label="Through month" className="flex-1">
          <input type="month" className={controlInset} value={through} onChange={e => { setThrough(e.target.value); setPlan(null); }} />
        </Field>
        <button onClick={preview} disabled={busy || !through}
          className="h-[38px] px-4 rounded-lg text-[13px] font-medium bg-stone-800 text-stone-200 hover:bg-stone-700 disabled:opacity-60">Preview</button>
      </div>
      {plan && (plan.count === 0 ? <p className="text-[13px] text-stone-400">Nothing to post - everything is up to date.</p> : (
        <>
          <p className="text-[13px] text-stone-300 mb-2">
            {plan.count} entr{plan.count === 1 ? "y" : "ies"}, total {fmt.num2(plan.total)}
            {plan.blocked > 0 && <span className="text-rose-400"> · {plan.blocked} in a closed period (nothing can post until reopened)</span>}
          </p>
          <table className="w-full text-[13px]">
            <thead><tr><th className={th}>Month</th><th className={th}>Asset</th><th className={th + " text-right"}>Amount</th></tr></thead>
            <tbody>{plan.plan.map(p => (
              <tr key={p.assetId + p.period} className="border-b border-stone-800/70">
                <td className="px-3 py-1.5 text-stone-300">{p.period}</td>
                <td className="px-3 py-1.5 text-stone-200">{p.assetName}{p.blocked && <span className="ml-2 text-[11px] text-rose-400">closed</span>}</td>
                <td className={num}>{fmt.num2(p.amount)}</td>
              </tr>))}
            </tbody>
          </table>
        </>
      ))}
    </Drawer>
  );
}
