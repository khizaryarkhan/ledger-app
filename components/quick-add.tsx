"use client";

/**
 * Inline "+ Add new" quick-create drawer for the transaction forms, for the
 * kinds that have no richer, standalone drawer elsewhere in the app: Chart of
 * Accounts entries, tax rates, classes, locations. Any such dropdown can
 * create a missing record on the spot; on save it returns the new record so
 * the caller adds it to the list and selects it — no context switch.
 *
 * Customer/Supplier and Product/Service deliberately do NOT live here —
 * this component used to carry its own stripped-down copies of those two
 * forms (name/email/currency only; name/income account/price/tax only),
 * a SEPARATE form from the real ones (components/party-drawer.tsx's
 * PartyDrawer, components/products-register.tsx's NewItemDrawer) used
 * everywhere else a customer or item is created. That meant a customer or
 * item created inline from a transaction form silently skipped fields
 * (address, payment terms, tax number; item kind, trade flags, accounting)
 * the real forms require — reported as "this doesn't open the same drawer
 * we use to add a customer" and fixed by having every caller render the one
 * real drawer directly instead of asking this component to impersonate it.
 */

import { useEffect, useState } from "react";
import { Loader, Check } from "lucide-react";
import { controlInset, Drawer } from "@/components/form-kit";

export type QuickAddKind =
  | "account-income" | "account-expense" | "account-bank" | "account"
  | "tax" | "class" | "location";

const META: Record<QuickAddKind, { title: string; noun: string }> = {
  "account-income": { title: "New income account", noun: "account" },
  "account-expense": { title: "New expense account", noun: "account" },
  "account-bank": { title: "New bank account", noun: "account" },
  account: { title: "New account", noun: "account" },
  tax: { title: "New tax rate", noun: "tax rate" },
  class: { title: "New class", noun: "class" },
  location: { title: "New location", noun: "location" },
};

export function QuickAdd({ kind, accountTypes, onClose, onCreated }: {
  kind: QuickAddKind;
  // Only for kind "account" — the caller restricts which AccountTypes are
  // valid here (e.g. a posting-group role only accepts "Cost of Goods Sold"),
  // same rule the role's own dropdown already filters existing accounts by.
  accountTypes?: readonly string[];
  onClose: () => void; onCreated: (row: any) => void;
}) {
  const meta = META[kind];
  const [f, setF] = useState<Record<string, string>>({ name: "", rate: "", code: "", type: accountTypes?.[0] ?? "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  async function save() {
    if (!f.name.trim()) { setErr("A name is required."); return; }
    setSaving(true); setErr("");
    try {
      let url = "", body: any = {};
      if (kind.startsWith("account")) {
        url = "/api/accounting/accounts";
        const type = kind === "account-income" ? "Income" : kind === "account-expense" ? "Expense" : kind === "account-bank" ? "Bank" : f.type;
        body = { name: f.name, type, code: f.code || undefined };
      } else if (kind === "tax") {
        url = "/api/accounting/tax-rates";
        body = { name: f.name, rate: Number(f.rate) || 0 };
      } else { // class / location
        url = "/api/accounting/dimensions";
        body = { name: f.name, dimensionType: kind === "class" ? "Class" : "Location" };
      }
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "Couldn't create"); return; }
      onCreated(d);
    } finally { setSaving(false); }
  }

  const label = "block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1";
  const input = controlInset;

  return (
    // Opens from inside the New Document form, so it has to sit above it.
    <Drawer title={meta.title} onClose={onClose} elevated
      footer={
        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose} className="text-[13px] text-stone-400 hover:text-stone-200 px-3 py-2">Cancel</button>
          <button onClick={save} disabled={saving || !f.name.trim() || (kind === "account" && !f.type)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold disabled:opacity-50">
            {saving ? <Loader size={14} className="animate-spin" /> : <Check size={15} />} Add {meta.noun}
          </button>
        </div>
      }>
        <div className="space-y-4">
          {err && <div className="text-[12px] text-rose-400">{err}</div>}
          <div><label className={label}>Name *</label>
            <input autoFocus value={f.name} onChange={e => set("name", e.target.value)} className={input} /></div>

          {kind === "account" && accountTypes && accountTypes.length > 1 && (
            <div><label className={label}>Type *</label>
              <select value={f.type} onChange={e => set("type", e.target.value)} className={input}>
                {accountTypes.map(ty => <option key={ty} value={ty}>{ty}</option>)}
              </select>
            </div>
          )}
          {kind === "account" && accountTypes && accountTypes.length === 1 && (
            <div className="text-[12px] text-stone-400">Type: {accountTypes[0]}</div>
          )}
          {kind.startsWith("account") && (
            <div><label className={label}>Account number (optional)</label><input value={f.code} onChange={e => set("code", e.target.value)} placeholder="e.g. 4100" className={input} /></div>
          )}
          {kind === "tax" && (
            <div><label className={label}>Rate % *</label><input type="number" step="0.01" value={f.rate} onChange={e => set("rate", e.target.value)} className={input} /></div>
          )}
        </div>
    </Drawer>
  );
}
