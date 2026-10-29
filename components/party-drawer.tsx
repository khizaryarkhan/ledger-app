"use client";

/**
 * Side drawer to create a Customer / Supplier / Employee in the Accounting
 * module. World-class, internationally-generic fields (State/Province/County,
 * Postal code, Country, Tax registration no.) so it serves users anywhere.
 */

import { useEffect, useState } from "react";
import { X, Loader, Check, AlertTriangle, Users, Building2, Contact } from "lucide-react";
import { CURRENCIES } from "@/lib/accounting/currencies";
import { controlInset, Drawer, SelectField } from "@/components/form-kit";
import { useData } from "@/components/data-provider";

type PartyType = "customers" | "suppliers" | "employees";
const META: Record<PartyType, { title: string; noun: string; icon: any }> = {
  customers: { title: "New customer", noun: "customer", icon: Users },
  suppliers: { title: "New supplier", noun: "supplier", icon: Building2 },
  employees: { title: "New employee", noun: "employee", icon: Contact },
};

const empty = {
  name: "", companyName: "", firstName: "", lastName: "",
  email: "", phone: "", mobile: "", website: "",
  addressStreet: "", addressLine2: "", addressCity: "", addressState: "", addressPostcode: "", country: "",
  taxNumber: "", paymentTerms: "30", notes: "", currency: "",
  leadTimeDays: "",   // suppliers only (0114) — default when an item's own link has none
};

// Customers only — collections and credit settings. Kept apart from `empty` so
// they are only ever sent for a customer (a supplier edit must not carry a
// "status" that would silently re-activate it).
const customerEmpty = { code: "", riskRating: "Low", status: "Active", creditLimit: "", paymentMethod: "", countryId: "" };
const PAYMENT_METHODS = ["Bank Transfer", "Credit Card", "Direct Debit", "Cheque", "Other"];

export function PartyDrawer({ type, editId, onClose, onCreated, elevated }: { type: PartyType; editId?: string | null; onClose: () => void; onCreated: (row?: any) => void; elevated?: boolean }) {
  const meta = META[type];
  const isPerson = type === "employees";
  const isCustomer = type === "customers";
  const editing = !!editId;
  const { countries } = useData() as any;
  const orgCountries: any[] = isCustomer ? (countries ?? []) : [];
  const [f, setF] = useState({ ...empty });
  const [x, setX] = useState({ ...customerEmpty });
  const [loadedBlankCurrency, setLoadedBlankCurrency] = useState(false);
  const [home, setHome] = useState("");
  const [mc, setMc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // A customer's currency is left blank until it is chosen: the server then
  // defaults it to the home currency, or — under multi-currency — leaves it to
  // lock to the customer's first transaction. Pre-filling home here would
  // lock it before the customer has transacted in anything.
  const canLeaveCurrencyUnset = isCustomer && (!editing || loadedBlankCurrency);

  useEffect(() => {
    fetch("/api/org/settings").then(r => r.json()).then(o => {
      const h = o?.currency || ""; setHome(h); setMc(!!o?.multicurrencyEnabled);
      if (!isCustomer) setF(prev => ({ ...prev, currency: prev.currency || h }));
    }).catch(() => {});
  }, [isCustomer]);
  // Edit mode: prefill from the existing record.
  useEffect(() => {
    if (!editId) return;
    fetch(`/api/parties/${type}/${editId}`).then(r => r.json()).then(d => {
      if (!d || d.error) return;
      setF(prev => ({
        ...prev,
        name: d.name ?? "", companyName: d.companyName ?? "", firstName: d.firstName ?? "", lastName: d.lastName ?? "",
        email: d.email ?? "", phone: d.phone ?? "", mobile: d.mobile ?? "", website: d.website ?? "",
        addressStreet: d.addressStreet ?? "", addressLine2: d.addressLine2 ?? "", addressCity: d.addressCity ?? "",
        addressState: d.addressState ?? "", addressPostcode: d.addressPostcode ?? "", country: d.country ?? "",
        taxNumber: d.taxNumber ?? "", paymentTerms: d.paymentTerms != null ? String(d.paymentTerms) : prev.paymentTerms,
        notes: d.notes ?? "", currency: d.currency ?? prev.currency,
        leadTimeDays: d.leadTimeDays != null ? String(d.leadTimeDays) : "",
      }));
      if (type === "customers") {
        setLoadedBlankCurrency(!d.currency);
        setX({
          code: d.code ?? "", riskRating: d.riskRating ?? "Low", status: d.status ?? "Active",
          creditLimit: d.creditLimit != null ? String(d.creditLimit) : "",
          paymentMethod: d.paymentMethod ?? "", countryId: d.countryId ?? "",
        });
      }
    }).catch(() => {});
  }, [editId, type]);
  // Close on Escape.
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  const set = (k: keyof typeof empty, v: string) => setF(prev => ({ ...prev, [k]: v }));
  const setExtra = (k: keyof typeof customerEmpty, v: string) => setX(prev => ({ ...prev, [k]: v }));
  // The org's country list is what regions and rep books group by, so the pick
  // is stored as an id AND its name goes into the display text the detail page
  // and printed documents read.
  const pickCountry = (id: string) => {
    setExtra("countryId", id);
    set("country", orgCountries.find((c: any) => c.id === id)?.name ?? "");
  };

  async function save() {
    if (!f.name.trim()) { setErr(isPerson ? "Employee name is required." : "Display name is required."); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch(editing ? `/api/parties/${type}/${editId}` : `/api/parties/${type}`, {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isCustomer ? { ...f, ...x } : f),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "Failed to save"); return; }
      onCreated(d);
    } finally { setSaving(false); }
  }

  const label = "block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1";
  const input = controlInset;
  const section = "text-[12px] font-semibold text-stone-300 uppercase tracking-wider pt-2";
  const Icon = meta.icon;

  return (
    <Drawer size="lg" title={editing ? `Edit ${meta.noun}` : meta.title} onClose={onClose} elevated={elevated}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose} className="text-[13px] text-stone-400 hover:text-stone-200 px-3 py-2">Cancel</button>
          <button onClick={save} disabled={saving || !f.name.trim()} className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold disabled:opacity-50">
            {saving ? <Loader size={14} className="animate-spin" /> : <Check size={15} />} {editing ? "Save changes" : `Save ${meta.noun}`}
          </button>
        </div>
      }>
        <div className="space-y-4">
          {err && <div className="text-[12px] text-rose-400 bg-rose-950/40 border border-rose-900 rounded-lg px-3 py-2 inline-flex items-center gap-2"><AlertTriangle size={13} /> {err}</div>}

          {mc && (
            <div>
              <label className={label}>Currency</label>
              <select value={f.currency} onChange={e => set("currency", e.target.value)} className={input}>
                {canLeaveCurrencyUnset && <option value="">Set by first transaction</option>}
                {home && !CURRENCIES.some(c => c.code === home) && <option value={home}>{home} (home)</option>}
                {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}{c.code === home ? " (home)" : ""}</option>)}
              </select>
              <p className="text-[11px] text-amber-500/80 mt-1">Set the currency carefully — it can't be changed after the first transaction.</p>
            </div>
          )}

          <div>
            <label className={label}>{isPerson ? "Employee name *" : "Display name *"}</label>
            <input autoFocus value={f.name} onChange={e => set("name", e.target.value)} placeholder={isPerson ? "e.g. Ayesha Khan" : "The name shown on documents"} className={input} />
          </div>

          {!isPerson && (
            <>
              <div>
                <label className={label}>Company name</label>
                <input value={f.companyName} onChange={e => set("companyName", e.target.value)} className={input} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>First name</label><input value={f.firstName} onChange={e => set("firstName", e.target.value)} className={input} /></div>
                <div><label className={label}>Last name</label><input value={f.lastName} onChange={e => set("lastName", e.target.value)} className={input} /></div>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Email</label><input type="email" value={f.email} onChange={e => set("email", e.target.value)} className={input} /></div>
            <div><label className={label}>Phone</label><input value={f.phone} onChange={e => set("phone", e.target.value)} className={input} /></div>
          </div>

          {!isPerson && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Mobile</label><input value={f.mobile} onChange={e => set("mobile", e.target.value)} className={input} /></div>
                <div><label className={label}>Website</label><input value={f.website} onChange={e => set("website", e.target.value)} className={input} /></div>
              </div>

              <div className={section}>Address</div>
              <div><label className={label}>Street address</label><input value={f.addressStreet} onChange={e => set("addressStreet", e.target.value)} className={input} /></div>
              <div><label className={label}>Address line 2</label><input value={f.addressLine2} onChange={e => set("addressLine2", e.target.value)} className={input} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>City / Town</label><input value={f.addressCity} onChange={e => set("addressCity", e.target.value)} className={input} /></div>
                <div><label className={label}>State / Province / County</label><input value={f.addressState} onChange={e => set("addressState", e.target.value)} className={input} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Postal / ZIP code</label><input value={f.addressPostcode} onChange={e => set("addressPostcode", e.target.value)} className={input} /></div>
                <div>
                  <label className={label}>Country</label>
                  {orgCountries.length > 0 ? (
                    <SelectField inset value={x.countryId} onChange={e => pickCountry(e.target.value)}>
                      <option value="">—</option>
                      {orgCountries.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </SelectField>
                  ) : (
                    <input value={f.country} onChange={e => set("country", e.target.value)} placeholder="e.g. Pakistan" className={input} />
                  )}
                </div>
              </div>

              <div className={section}>Terms &amp; tax</div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Payment terms (days)</label><input type="number" min="0" value={f.paymentTerms} onChange={e => set("paymentTerms", e.target.value)} className={input} /></div>
                <div><label className={label}>Tax reg. no. (VAT/GST/NTN)</label><input value={f.taxNumber} onChange={e => set("taxNumber", e.target.value)} className={input} /></div>
              </div>
              {type === "suppliers" && (
                <div>
                  <label className={label}>Default lead time (days)</label>
                  <input type="number" min="0" max="3650" step="1" value={f.leadTimeDays} onChange={e => set("leadTimeDays", e.target.value)} placeholder="e.g. 14" className={input} />
                  <p className="mt-1 text-[11px] text-stone-500">Used to set a PO line&apos;s requested date when the item&apos;s own supplier link has no lead time.</p>
                </div>
              )}
              {isCustomer && (
                <>
                  <div className={section}>Collections &amp; credit</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={label}>Customer code</label>
                      <input value={x.code} onChange={e => setExtra("code", e.target.value)} placeholder="Auto-generated if blank" className={input} />
                    </div>
                    <div>
                      <label className={label}>Credit limit</label>
                      <input type="number" min="0" value={x.creditLimit} onChange={e => setExtra("creditLimit", e.target.value)} className={input} />
                    </div>
                    <div>
                      <label className={label}>Risk rating</label>
                      <SelectField inset value={x.riskRating} onChange={e => setExtra("riskRating", e.target.value)}>
                        {["Low", "Medium", "High"].map(r => <option key={r} value={r}>{r}</option>)}
                      </SelectField>
                    </div>
                    <div>
                      <label className={label}>Status</label>
                      <SelectField inset value={x.status} onChange={e => setExtra("status", e.target.value)}>
                        {["Active", "On Hold", "Inactive"].map(s => <option key={s} value={s}>{s}</option>)}
                      </SelectField>
                    </div>
                    <div>
                      <label className={label}>Payment method</label>
                      <SelectField inset value={x.paymentMethod} onChange={e => setExtra("paymentMethod", e.target.value)}>
                        <option value="">—</option>
                        {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                      </SelectField>
                    </div>
                  </div>
                </>
              )}
              <div><label className={label}>Notes</label><textarea value={f.notes} onChange={e => set("notes", e.target.value)} rows={2} className={input} /></div>
            </>
          )}
        </div>
    </Drawer>
  );
}
