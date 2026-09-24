"use client";

/**
 * The accounting half of a stocked item's form (R-07). An item does not choose
 * its accounts; it joins a POSTING GROUP, and the group's roles say where its
 * stock, cost of sales and revenue post. So the accounts are shown here READ-
 * ONLY, as inherited. An admin can override one — each override is limited to
 * accounts of the type its role requires, and the server re-checks it.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Field, SelectField, Section, t } from "@/components/form-kit";
import {
  GROUP_TYPE_META, ROLES, allowedTypesFor, groupTypeForKind, roleForOverride,
  type AccountRole, type GroupType, type OverrideField,
} from "@/lib/accounting/account-roles";
import { kindOf } from "@/lib/inventory/item-kinds";

type Acct = { id: string; name: string; code: string | null; type: string | null; status: string; isHeader: boolean };
type Group = { id: string; name: string; groupType: GroupType; isDefault: boolean; roles: Partial<Record<AccountRole, string>> };
export type ItemAccountingValue = { postingGroupId: string; assetAccountId: string; cogsAccountId: string; incomeAccountId: string };

const label = (a?: Acct) => a ? `${a.code ? a.code + " · " : ""}${a.name}` : "";

export function ItemAccountingSection({ productType, value, onChange }: {
  productType: string;
  value: ItemAccountingValue;
  onChange: (patch: Partial<ItemAccountingValue>) => void;
}) {
  const [data, setData] = useState<{ groups: Group[]; accounts: Acct[]; canEdit: boolean } | null>(null);
  const [override, setOverride] = useState(!!(value.assetAccountId || value.cogsAccountId || value.incomeAccountId));
  useEffect(() => {
    fetch("/api/accounting/posting-groups").then(r => r.json()).then(d => setData(d?.groups ? d : { groups: [], accounts: [], canEdit: false })).catch(() => setData({ groups: [], accounts: [], canEdit: false }));
  }, []);

  const type = groupTypeForKind(productType);
  if (!type) return null;
  const meta = kindOf(productType);
  const groups = (data?.groups ?? []).filter(g => g.groupType === type);
  const group = groups.find(g => g.id === value.postingGroupId) ?? groups.find(g => g.isDefault);
  const byId = new Map((data?.accounts ?? []).map(a => [a.id, a]));

  const rows: { field: OverrideField; title: string; show: boolean }[] = [
    { field: "assetAccountId",  title: "Stock",          show: true },
    { field: "cogsAccountId",   title: "Cost of sales",  show: true },
    { field: "incomeAccountId", title: "Sales",          show: meta.sellable },
  ];

  return (
    <Section title="Accounting" className="pt-2 border-t border-stone-800"
      desc={<>Posts through its posting group. <Link href="/accounting/posting-groups" className="text-emerald-400 hover:text-emerald-300">Manage groups</Link></>}>
      <Field label="Posting group" required hint={`Only ${GROUP_TYPE_META[type].label.toLowerCase()} groups can hold this item.`}>
        <SelectField inset value={value.postingGroupId} onChange={e => onChange({ postingGroupId: e.target.value })}>
          <option value="">{group?.isDefault || !value.postingGroupId ? `${groups.find(g => g.isDefault)?.name ?? GROUP_TYPE_META[type].defaultGroupName} (default)` : "Default group"}</option>
          {groups.filter(g => !g.isDefault).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </SelectField>
      </Field>

      <div className="rounded-lg border border-stone-800 divide-y divide-stone-800">
        {rows.filter(r => r.show).map(r => {
          const role = roleForOverride(r.field, type);
          const inherited = group?.roles[role];
          const own = value[r.field];
          const shown = own || inherited;
          return (
            <div key={r.field} className="px-3 py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className={t.label}>{r.title}</div>
                <div className={t.hint}>{ROLES[role].label}</div>
              </div>
              <div className="text-right min-w-0">
                <div className={shown ? "text-[13px] text-stone-200 truncate" : "text-[13px] text-amber-400"}>{shown ? label(byId.get(shown)) || "…" : "Not mapped"}</div>
                <div className={t.hint}>{own ? "override" : "from group"}</div>
              </div>
            </div>
          );
        })}
      </div>

      {data?.canEdit && (
        <label className="flex items-center gap-2 text-[12px] text-stone-400 cursor-pointer">
          <input type="checkbox" checked={override} className="accent-emerald-600"
            onChange={e => { setOverride(e.target.checked); if (!e.target.checked) onChange({ assetAccountId: "", cogsAccountId: "", incomeAccountId: "" }); }} />
          Override accounts for this item only
        </label>
      )}
      {override && data?.canEdit && (
        <div className="grid grid-cols-1 gap-3">
          {rows.filter(r => r.show).map(r => {
            const role = roleForOverride(r.field, type);
            const ok = allowedTypesFor(role);
            const opts = (data?.accounts ?? []).filter(a => ok.includes(a.type ?? "") && !a.isHeader && a.status === "Active");
            return (
              <Field key={r.field} label={`${r.title} override`} hint={`${ok.join(" / ")} accounts only.`}>
                <SelectField inset value={value[r.field]} onChange={e => onChange({ [r.field]: e.target.value } as any)}>
                  <option value="">Use the group's account</option>
                  {opts.map(a => <option key={a.id} value={a.id}>{label(a)}</option>)}
                </SelectField>
              </Field>
            );
          })}
          <p className={t.hint}>An item holding stock can't move to a different stock account here: the value on hand would be left behind. Remap the group instead, which posts a reclass.</p>
        </div>
      )}
    </Section>
  );
}
