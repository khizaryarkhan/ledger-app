"use client";

/**
 * Tax Codes — native tax engine admin (sales-document refactor, Phase 3c).
 *
 * Three layers, each simpler than the one below it needs it to be:
 *   Agencies   — who tax is remitted to, and its liability account.
 *   Components — one named, DATED rate ("IE Standard 23%" from 2026-01-01),
 *                with its own sales/purchase accounts.
 *   Tax codes  — what a user picks on a document line ("IE Standard 23%",
 *                "EU B2B Reverse Charge"), built from one or more components.
 *
 * A synced org (QuickBooks/Xero) never sees this screen populated — its tax
 * rates and codes are managed in the connected system, not here.
 */

import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, X, Receipt } from "lucide-react";
import { ListPage, ListPageHeader } from "@/components/list-view";
import { Button, Toast } from "@/components/ui";
import { Drawer, DrawerFooter, Field, SelectField, Section, controlInset } from "@/components/form-kit";
import { TAX_TREATMENTS, TAX_TREATMENT_META } from "@/lib/accounting/tax-engine";
import { localToday } from "@/lib/format";

type Acct = { id: string; name: string; code: string | null; type: string | null; status: string; isHeader: boolean };
type Agency = { id: string; name: string; country: string | null; liabilityAccountId: string | null; filingFrequency: string | null };
type Component = { id: string; agencyId: string; name: string; rate: string; salesAccountId: string | null; purchaseAccountId: string | null; effectiveFrom: string; effectiveTo: string | null };
type CodeComponentLink = { linkId: string; componentId: string; sequence: number };
type Code = { id: string; name: string; treatment: string; compound: boolean; components: CodeComponentLink[] };
type Setup = { synced: boolean; canEdit: boolean; agencies: Agency[]; components: Component[]; codes: Code[]; accounts: Acct[] };

const LIABILITY_TYPES = ["Other Current Liability"];
const SALES_TYPES = ["Income", "Other Income"];
const PURCHASE_TYPES = ["Expense", "Cost of Goods Sold", "Other Expense"];
const acctLabel = (a?: Acct) => (a ? `${a.code ? a.code + " · " : ""}${a.name}` : "");

export function TaxCodes() {
  const [data, setData] = useState<Setup | null>(null);
  const [toast, setToast] = useState<any>(null);
  const [codeDrawer, setCodeDrawer] = useState<"new" | Code | null>(null);
  const [showAgencyForm, setShowAgencyForm] = useState(false);
  const [showComponentForm, setShowComponentForm] = useState(false);

  async function load() {
    const r = await fetch("/api/accounting/tax-codes").then(x => (x.ok ? x.json() : null)).catch(() => null);
    setData(r);
  }
  useEffect(() => { load(); }, []);

  async function del(url: string, label: string) {
    if (!confirm(`Delete ${label}?`)) return;
    const r = await fetch(url, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setToast({ type: "error", message: d?.error || "Could not delete." }); return; }
    setToast({ type: "success", message: "Deleted." });
    load();
  }

  if (!data) return <ListPage><div className="p-6 text-stone-500 text-[13px]">Loading…</div></ListPage>;

  if (data.synced) {
    return (
      <ListPage>
        <ListPageHeader title="Tax Codes" subtitle="This organisation's chart is connected to QuickBooks or Xero — its tax rates are managed there, not here." />
      </ListPage>
    );
  }

  const agencyName = (id: string) => data.agencies.find(a => a.id === id)?.name ?? "—";
  const componentById = new Map(data.components.map(c => [c.id, c]));

  return (
    <ListPage>
      <ListPageHeader
        title="Tax Codes"
        subtitle="Agencies, dated rates and the codes built from them — what Invoices, Estimates and other sales documents post tax through."
      >
        {data.canEdit && <Button icon={Plus} onClick={() => setCodeDrawer("new")}>New tax code</Button>}
      </ListPageHeader>

      <div className="flex-1 overflow-auto p-6 space-y-8 max-w-5xl">
        {/* ── Agencies ── */}
        <Section title="Agencies" desc="Who tax is remitted to, and the control account its liability defaults to.">
          <div className="rounded-lg border border-stone-800 divide-y divide-stone-800">
            {data.agencies.length === 0 && <div className="px-3 py-3 text-[12px] text-stone-500">No agencies yet.</div>}
            {data.agencies.map(a => (
              <div key={a.id} className="px-3 py-2 flex items-center justify-between gap-3 text-[13px]">
                <div className="min-w-0">
                  <div className="text-stone-200 font-medium">{a.name}{a.country ? ` · ${a.country}` : ""}</div>
                  <div className="text-[11px] text-stone-500">
                    {acctLabel(data.accounts.find(x => x.id === a.liabilityAccountId)) || "No liability account set"}
                    {a.filingFrequency ? ` · ${a.filingFrequency}` : ""}
                  </div>
                </div>
                {data.canEdit && (
                  <button onClick={() => del(`/api/accounting/tax-agencies/${a.id}`, a.name)} className="shrink-0 text-stone-500 hover:text-rose-400 p-1">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {data.canEdit && !showAgencyForm && (
            <button onClick={() => setShowAgencyForm(true)} className="text-[12px] text-emerald-400 hover:text-emerald-300 font-medium">+ Add agency</button>
          )}
          {showAgencyForm && (
            <AgencyForm accounts={data.accounts} onClose={() => setShowAgencyForm(false)}
              onSaved={() => { setShowAgencyForm(false); load(); }} toast={setToast} />
          )}
        </Section>

        {/* ── Components ── */}
        <Section title="Tax components" desc="One named, dated rate. A rate change is a NEW component, not an edit — a historical document never restates when a rate changes.">
          <div className="rounded-lg border border-stone-800 divide-y divide-stone-800">
            {data.components.length === 0 && <div className="px-3 py-3 text-[12px] text-stone-500">No components yet.</div>}
            {data.components.map(c => (
              <div key={c.id} className="px-3 py-2 flex items-center justify-between gap-3 text-[13px]">
                <div className="min-w-0">
                  <div className="text-stone-200 font-medium">{c.name} · {Number(c.rate)}%</div>
                  <div className="text-[11px] text-stone-500">
                    {agencyName(c.agencyId)} · from {c.effectiveFrom}{c.effectiveTo ? ` to ${c.effectiveTo}` : ""}
                    {c.salesAccountId ? ` · Sales: ${acctLabel(data.accounts.find(x => x.id === c.salesAccountId))}` : ""}
                    {c.purchaseAccountId ? ` · Purchase: ${acctLabel(data.accounts.find(x => x.id === c.purchaseAccountId))}` : ""}
                  </div>
                </div>
                {data.canEdit && (
                  <button onClick={() => del(`/api/accounting/tax-components/${c.id}`, c.name)} className="shrink-0 text-stone-500 hover:text-rose-400 p-1">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {data.canEdit && !showComponentForm && (
            <button onClick={() => setShowComponentForm(true)} disabled={!data.agencies.length}
              className="text-[12px] text-emerald-400 hover:text-emerald-300 font-medium disabled:text-stone-600 disabled:cursor-not-allowed">
              + Add component{!data.agencies.length ? " (add an agency first)" : ""}
            </button>
          )}
          {showComponentForm && (
            <ComponentForm agencies={data.agencies} accounts={data.accounts} onClose={() => setShowComponentForm(false)}
              onSaved={() => { setShowComponentForm(false); load(); }} toast={setToast} />
          )}
        </Section>

        {/* ── Codes ── */}
        <Section title="Tax codes" desc="What a user actually picks on a document line.">
          <div className="rounded-lg border border-stone-800 divide-y divide-stone-800">
            {data.codes.length === 0 && <div className="px-3 py-3 text-[12px] text-stone-500">No tax codes yet.</div>}
            {data.codes.map(code => (
              <div key={code.id} className="px-3 py-2.5 flex items-center justify-between gap-3 text-[13px]">
                <div className="min-w-0">
                  <div className="text-stone-200 font-medium flex items-center gap-2">
                    {code.name}
                    <span className="text-[10px] uppercase tracking-wide text-stone-500 bg-stone-800 rounded-full px-2 py-0.5">{TAX_TREATMENT_META[code.treatment as keyof typeof TAX_TREATMENT_META]?.label ?? code.treatment}</span>
                    {code.compound && <span className="text-[10px] uppercase tracking-wide text-amber-400 bg-amber-500/10 rounded-full px-2 py-0.5">Compound</span>}
                  </div>
                  <div className="text-[11px] text-stone-500">
                    {code.components.length
                      ? code.components.map(l => { const c = componentById.get(l.componentId); return c ? `${c.name} (${Number(c.rate)}%)` : "—"; }).join(" + ")
                      : "No components"}
                  </div>
                </div>
                {data.canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setCodeDrawer(code)} className="text-stone-500 hover:text-stone-200 p-1"><Pencil size={13} /></button>
                    <button onClick={() => del(`/api/accounting/tax-codes/${code.id}`, code.name)} className="text-stone-500 hover:text-rose-400 p-1"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      </div>

      {codeDrawer && (
        <CodeDrawer code={codeDrawer === "new" ? null : codeDrawer} components={data.components} agencyName={agencyName}
          onClose={() => setCodeDrawer(null)} onSaved={() => { setCodeDrawer(null); load(); }} toast={setToast} />
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </ListPage>
  );
}

/* ── Agency form ── */
function AgencyForm({ accounts, onClose, onSaved, toast }: { accounts: Acct[]; onClose: () => void; onSaved: () => void; toast: (t: any) => void }) {
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [liabilityAccountId, setLiabilityAccountId] = useState("");
  const [filingFrequency, setFilingFrequency] = useState("");
  const [saving, setSaving] = useState(false);
  const opts = accounts.filter(a => LIABILITY_TYPES.includes(a.type ?? "") && !a.isHeader && a.status === "Active");

  async function save() {
    if (!name.trim()) { toast({ type: "error", message: "Give the agency a name." }); return; }
    setSaving(true);
    const r = await fetch("/api/accounting/tax-agencies", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, country: country || null, liabilityAccountId: liabilityAccountId || null, filingFrequency: filingFrequency || null }),
    });
    setSaving(false);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast({ type: "error", message: d?.error || "Could not save." }); return; }
    onSaved();
  }

  return (
    <div className="rounded-lg border border-stone-700 bg-stone-900/60 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-stone-200">New agency</span>
        <button onClick={onClose} className="text-stone-500 hover:text-stone-200"><X size={14} /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" required><input className={controlInset} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Irish Revenue" /></Field>
        <Field label="Country / region code"><input className={controlInset} value={country} onChange={e => setCountry(e.target.value.toUpperCase())} placeholder="e.g. IE" maxLength={8} /></Field>
        <Field label="Liability account" hint="Other Current Liability accounts only.">
          <SelectField inset value={liabilityAccountId} onChange={e => setLiabilityAccountId(e.target.value)}>
            <option value="">Select…</option>
            {opts.map(a => <option key={a.id} value={a.id}>{acctLabel(a)}</option>)}
          </SelectField>
        </Field>
        <Field label="Filing frequency"><input className={controlInset} value={filingFrequency} onChange={e => setFilingFrequency(e.target.value)} placeholder="e.g. Quarterly" /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-[12px] text-stone-400 hover:text-stone-200">Cancel</button>
        <button onClick={save} disabled={saving} className="px-3 py-1.5 text-[12px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50">Save</button>
      </div>
    </div>
  );
}

/* ── Component form ── */
function ComponentForm({ agencies, accounts, onClose, onSaved, toast }: { agencies: Agency[]; accounts: Acct[]; onClose: () => void; onSaved: () => void; toast: (t: any) => void }) {
  const [agencyId, setAgencyId] = useState(agencies[0]?.id ?? "");
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [salesAccountId, setSalesAccountId] = useState("");
  const [purchaseAccountId, setPurchaseAccountId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(localToday());
  const [saving, setSaving] = useState(false);
  const salesOpts = accounts.filter(a => SALES_TYPES.includes(a.type ?? "") && !a.isHeader && a.status === "Active");
  const purchaseOpts = accounts.filter(a => PURCHASE_TYPES.includes(a.type ?? "") && !a.isHeader && a.status === "Active");

  async function save() {
    if (!name.trim()) { toast({ type: "error", message: "Give the component a name." }); return; }
    if (!agencyId) { toast({ type: "error", message: "Choose an agency." }); return; }
    const r2 = Number(rate);
    if (!Number.isFinite(r2) || r2 < 0 || r2 > 100) { toast({ type: "error", message: "Rate must be between 0 and 100." }); return; }
    setSaving(true);
    const r = await fetch("/api/accounting/tax-components", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agencyId, name, rate: r2, salesAccountId: salesAccountId || null, purchaseAccountId: purchaseAccountId || null, effectiveFrom }),
    });
    setSaving(false);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast({ type: "error", message: d?.error || "Could not save." }); return; }
    onSaved();
  }

  return (
    <div className="rounded-lg border border-stone-700 bg-stone-900/60 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-stone-200">New component</span>
        <button onClick={onClose} className="text-stone-500 hover:text-stone-200"><X size={14} /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Agency" required>
          <SelectField inset value={agencyId} onChange={e => setAgencyId(e.target.value)}>
            {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </SelectField>
        </Field>
        <Field label="Name" required><input className={controlInset} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. IE Standard 23%" /></Field>
        <Field label="Rate (%)" required><input type="number" step="0.01" className={controlInset} value={rate} onChange={e => setRate(e.target.value)} /></Field>
        <Field label="Effective from" required><input type="date" className={controlInset} value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} /></Field>
        <Field label="Sales account" hint="Falls back to the agency's liability account when blank.">
          <SelectField inset value={salesAccountId} onChange={e => setSalesAccountId(e.target.value)}>
            <option value="">Use agency's liability account</option>
            {salesOpts.map(a => <option key={a.id} value={a.id}>{acctLabel(a)}</option>)}
          </SelectField>
        </Field>
        <Field label="Purchase account" hint="Falls back to the agency's liability account when blank.">
          <SelectField inset value={purchaseAccountId} onChange={e => setPurchaseAccountId(e.target.value)}>
            <option value="">Use agency's liability account</option>
            {purchaseOpts.map(a => <option key={a.id} value={a.id}>{acctLabel(a)}</option>)}
          </SelectField>
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-[12px] text-stone-400 hover:text-stone-200">Cancel</button>
        <button onClick={save} disabled={saving} className="px-3 py-1.5 text-[12px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50">Save</button>
      </div>
    </div>
  );
}

/* ── Tax code drawer ── */
function CodeDrawer({ code, components, agencyName, onClose, onSaved, toast }: {
  code: Code | null; components: Component[]; agencyName: (id: string) => string;
  onClose: () => void; onSaved: () => void; toast: (t: any) => void;
}) {
  const [name, setName] = useState(code?.name ?? "");
  const [treatment, setTreatment] = useState<string>(code?.treatment ?? "standard");
  const [compound, setCompound] = useState(!!code?.compound);
  const [rows, setRows] = useState<{ componentId: string }[]>(code?.components.length ? code.components.map(l => ({ componentId: l.componentId })) : [{ componentId: "" }]);
  const [saving, setSaving] = useState(false);

  function setRow(i: number, componentId: string) {
    setRows(prev => prev.map((r, idx) => (idx === i ? { componentId } : r)));
  }
  function addRow() { setRows(prev => [...prev, { componentId: "" }]); }
  function removeRow(i: number) { setRows(prev => prev.filter((_, idx) => idx !== i)); }

  async function save() {
    if (!name.trim()) { toast({ type: "error", message: "Give the tax code a name." }); return; }
    const chosen = rows.map(r => r.componentId).filter(Boolean);
    setSaving(true);
    const url = code ? `/api/accounting/tax-codes/${code.id}` : "/api/accounting/tax-codes";
    const r = await fetch(url, {
      method: code ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, treatment, compound, components: chosen.map((componentId, sequence) => ({ componentId, sequence })) }),
    });
    setSaving(false);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast({ type: "error", message: d?.error || "Could not save." }); return; }
    onSaved();
  }

  return (
    <Drawer title={code ? `Edit ${code.name}` : "New tax code"} onClose={onClose}
      footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel={code ? "Save changes" : "Create tax code"} />}>
      <div className="space-y-5">
        <Field label="Name" required><input className={controlInset} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. IE Standard 23%" /></Field>
        <Field label="Treatment" required hint={TAX_TREATMENT_META[treatment as keyof typeof TAX_TREATMENT_META]?.chargesTax === false ? "This treatment posts zero tax on the document." : undefined}>
          <SelectField inset value={treatment} onChange={e => setTreatment(e.target.value)}>
            {TAX_TREATMENTS.map(t => <option key={t} value={t}>{TAX_TREATMENT_META[t].label}</option>)}
          </SelectField>
        </Field>
        <label className="flex items-center gap-2 text-[12px] text-stone-400 cursor-pointer">
          <input type="checkbox" checked={compound} onChange={e => setCompound(e.target.checked)} className="accent-emerald-600" />
          Compound — each component computes on top of the one before it (not just the same net)
        </label>
        <Section title="Components" desc="In calculation order. Almost always one; two for a split tax like CGST+SGST.">
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[11px] text-stone-500 w-4 text-right shrink-0">{i + 1}</span>
                <SelectField inset value={row.componentId} onChange={e => setRow(i, e.target.value)} className="flex-1">
                  <option value="">Select a component…</option>
                  {components.map(c => <option key={c.id} value={c.id}>{c.name} ({Number(c.rate)}%) — {agencyName(c.agencyId)}</option>)}
                </SelectField>
                <button onClick={() => removeRow(i)} className="shrink-0 text-stone-500 hover:text-rose-400 p-1"><X size={14} /></button>
              </div>
            ))}
            <button onClick={addRow} className="text-[12px] text-emerald-400 hover:text-emerald-300 font-medium">+ Add component</button>
          </div>
        </Section>
      </div>
    </Drawer>
  );
}
