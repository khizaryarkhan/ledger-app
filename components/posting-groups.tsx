"use client";

/**
 * Posting Groups — the Chart of Accounts mapping for inventory.
 *
 * Every stock posting names a ROLE; the item's posting group says which
 * account plays it. This screen is where that mapping is set, per group, with
 * each dropdown offering only accounts of the type the role requires. A
 * tracked item whose group has any role unmapped cannot move stock, so an
 * incomplete group is shown as the blocker it is.
 *
 * Every account is still the user's own choice (nothing is filled in for
 * them), but the screen asks only for what applies: production accounts only
 * when the org runs production, the four accounts most companies share across
 * groups once ("Shared accounts"), and no warnings for a group with no items.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Plus, Sparkles, Layers } from "lucide-react";
import { ListPage, ListPageHeader } from "@/components/list-view";
import { Button, Modal, Toast } from "@/components/ui";
import { Drawer, DrawerFooter, Field, SelectField, controlInset, control, t } from "@/components/form-kit";
import {
  ROLES, GROUP_TYPES, GROUP_TYPE_META, INVENTORY_ROLES, SHARED_ROLES, ROLE_REPORT_HINT, groupRoleSections,
  allowedTypesFor, roleAccountError, requiredRoles, isRoleForGroupType, isSharedRole, type AccountRole, type GroupType,
} from "@/lib/accounting/account-roles";
import { fmt, localToday } from "@/lib/format";
import { useData } from "@/components/data-provider";
import { QuickAdd } from "@/components/quick-add";

type Acct = { id: string; name: string; code: string | null; type: string | null; status: string; isHeader: boolean; defaultRole: string | null; source: string };
type Group = { id: string; name: string; groupType: GroupType; isDefault: boolean; roles: Partial<Record<AccountRole, string>>; itemCount: number; missing: AccountRole[] };
type Reclass = { role: AccountRole; fromAccountId: string; toAccountId: string; amount: number; basis: string; fromName: string; toName: string };

const acctLabel = (a?: Acct) => a ? `${a.code ? a.code + " · " : ""}${a.name}` : "";

export function PostingGroups() {
  const { orgSettings } = useData() as any;
  const ccy = orgSettings?.currency ?? "EUR";
  const [data, setData] = useState<{ synced: boolean; production: boolean; canEdit: boolean; groups: Group[]; accounts: Acct[] } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Record<AccountRole, string>>>({});
  const [effective, setEffective] = useState(localToday());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Reclass[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<any>(null);
  const [quickAddRole, setQuickAddRole] = useState<AccountRole | null>(null);
  const [quickAddShared, setQuickAddShared] = useState(false);
  // Shared accounts are hidden inside a group until the user asks to set one separately.
  const [ownShared, setOwnShared] = useState(false);

  async function load(keep?: string | null) {
    const res = await fetch("/api/accounting/posting-groups");
    const d = await res.json();
    if (!res.ok) { setToast({ message: d?.error || "Could not load posting groups", type: "error" }); return; }
    setData(d);
    const still = keep && d.groups.some((g: Group) => g.id === keep) ? keep : d.groups[0]?.id ?? null;
    setSel(still);
    setDraft({});
  }
  useEffect(() => { load(); }, []);

  const group = data?.groups.find(g => g.id === sel) ?? null;
  const byId = useMemo(() => new Map((data?.accounts ?? []).map(a => [a.id, a])), [data]);
  const dirty = Object.keys(draft).filter(r => group && draft[r as AccountRole] !== group.roles[r as AccountRole]) as AccountRole[];
  const touchesStock = dirty.some(r => (INVENTORY_ROLES as readonly string[]).includes(r));
  const scope = { production: data?.production !== false };
  // A group with no items blocks nothing, so it neither warns nor counts.
  const inUse = (data?.groups ?? []).filter(g => g.itemCount > 0);
  const idle = (data?.groups ?? []).filter(g => g.itemCount === 0);
  const anyMissing = inUse.some(g => g.missing.length);
  const needed = inUse.reduce((n, g) => n + requiredRoles(g.groupType, scope).length, 0);
  const chosen = needed - inUse.reduce((n, g) => n + g.missing.length, 0);

  const sharedValues = (role: AccountRole) =>
    new Set((data?.groups ?? []).filter(g => isRoleForGroupType(role, g.groupType)).map(g => g.roles[role] ?? ""));
  // The one account every group agrees on for a shared role; null when they differ or none is set.
  const sharedValue = (role: AccountRole): string | null => {
    const vals = sharedValues(role);
    const [only] = [...vals];
    return vals.size === 1 && only ? only : null;
  };
  // Inside a group, a shared role's row shows only when it differs from the shared choice.
  const hiddenInGroup = (g: Group, role: AccountRole) =>
    isSharedRole(role) && !ownShared && draft[role] === undefined && !!g.roles[role] && sharedValue(role) === g.roles[role];

  const optionsFor = (role: AccountRole) => {
    const ok = allowedTypesFor(role);
    return (data?.accounts ?? []).filter(a => ok.includes(a.type ?? "") && !a.isHeader && a.status === "Active");
  };

  async function save(withConfirm = false) {
    if (!group) return;
    setSaving(true); setErr(null);
    try {
      const roles = Object.fromEntries(dirty.map(r => [r, draft[r]]));
      const res = await fetch(`/api/accounting/posting-groups/${group.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles, effectiveDate: effective, confirm: withConfirm }),
      });
      const d = await res.json();
      if (res.status === 409 && d?.needsConfirm) { setConfirm(d.reclass); return; }
      if (!res.ok) throw new Error(d?.error || "Could not save the mapping");
      setConfirm(null);
      setToast({ message: d.reclassEntryId ? "Mapping saved and balance reclassified" : "Mapping saved", type: "success" });
      await load(group.id);
    } catch (e: any) {
      setErr(e.message); setConfirm(null);
    } finally { setSaving(false); }
  }

  /** Write one account to every group that uses the role: the "set once" path. */
  async function applyShared(role: AccountRole, accountId: string) {
    if (!accountId || !data) return;
    setSaving(true);
    try {
      for (const g of data.groups.filter(x => isRoleForGroupType(role, x.groupType) && x.roles[role] !== accountId)) {
        const res = await fetch(`/api/accounting/posting-groups/${g.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roles: { [role]: accountId }, effectiveDate: localToday(), confirm: false }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d?.error || `Could not set ${ROLES[role].label} on ${g.name}`);
      }
      setToast({ message: `${ROLES[role].label} set for every group`, type: "success" });
    } catch (e: any) {
      setToast({ message: e.message, type: "error" });
    } finally {
      setSaving(false);
      await load(sel);
    }
  }

  async function provision() {
    setSaving(true);
    try {
      const res = await fetch("/api/accounting/posting-groups/provision", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Could not create the default accounts");
      const n = d.createdAccounts?.length ?? 0;
      setToast({ message: n ? `Created ${n} account${n === 1 ? "" : "s"} and mapped the open roles` : "Every default role was already mapped", type: "success" });
      await load(sel);
    } catch (e: any) { setToast({ message: e.message, type: "error" }); }
    finally { setSaving(false); }
  }

  if (!data) return <div className="p-6 text-[13px] text-stone-500">Loading…</div>;

  return (
    <ListPage>
      <ListPageHeader
        title="Posting Groups"
        subtitle="Which account each inventory posting goes to. Every item that holds stock posts through its group."
      >
        <Link href="/accounting/reports/stock-vs-gl" className="text-[12px] text-stone-400 hover:text-stone-200 mr-2">Stock vs GL report →</Link>
        {data.canEdit && anyMissing && (
          <Button variant="secondary" icon={Sparkles} onClick={provision} disabled={saving}>Create missing default accounts</Button>
        )}
        {data.canEdit && <Button icon={Plus} onClick={() => setCreating(true)}>New group</Button>}
      </ListPageHeader>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {data.synced && (
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-4 py-3 text-[13px] text-stone-300">
            Your chart of accounts is synced from QuickBooks or Xero. Map each role to one of your existing accounts.
            Nothing is created or changed in the external ledger. <span className="text-stone-500">"Create missing default accounts" adds them here only.</span>
          </div>
        )}
        {needed > 0 && (
          <div className={`rounded-lg border px-4 py-3 ${anyMissing ? "border-amber-500/30 bg-amber-500/5" : "border-stone-800 bg-stone-900/40"}`}>
            <div className="flex items-center gap-2 text-[13px]">
              {anyMissing ? <AlertTriangle size={16} className="text-amber-400 shrink-0" /> : <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />}
              <span className={anyMissing ? "text-amber-200" : "text-stone-300"}>
                {anyMissing
                  ? `${chosen} of ${needed} accounts chosen. Items in a group can't be received, sold or adjusted until its accounts are chosen.`
                  : `All ${needed} accounts chosen. Setup is complete for the groups you use.`}
              </span>
            </div>
            {anyMissing && (
              <div className="mt-2 h-1 rounded bg-stone-800 overflow-hidden">
                <div className="h-full bg-amber-400" style={{ width: `${Math.round((chosen / needed) * 100)}%` }} />
              </div>
            )}
          </div>
        )}

        {/* Shared accounts: chosen once, written to every group. */}
        <div className="rounded-lg border border-stone-800 bg-stone-900/40">
          <div className="px-4 py-3 border-b border-stone-800">
            <div className={t.heading}>Shared accounts</div>
            <div className={t.hint}>Chosen once and used by every group. A group can still be given its own.</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            {SHARED_ROLES.map(r => {
              const value = sharedValue(r) ?? "";
              const mixed = !value && sharedValues(r).size > 1;
              return (
                <div key={r} className="px-4 py-2.5">
                  <div className={t.bodyStrong}>{ROLES[r].label}</div>
                  <div className={`${t.hint} mb-1.5`} title={`${ROLES[r].purpose} · ${allowedTypesFor(r).join(" / ")}`}>{ROLE_REPORT_HINT[r]}</div>
                  <SelectField value={value} disabled={!data.canEdit || saving}
                    onChange={e => {
                      if (e.target.value === "__add__") { setQuickAddShared(true); setQuickAddRole(r); return; }
                      applyShared(r, e.target.value);
                    }}>
                    <option value="">{mixed ? "Different in each group" : "— Not chosen —"}</option>
                    {optionsFor(r).map(a => <option key={a.id} value={a.id}>{acctLabel(a)}{a.source !== "native" ? ` (${a.source.toUpperCase()})` : ""}</option>)}
                    {data.canEdit && <option value="__add__">+ Add new account…</option>}
                  </SelectField>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          {/* Group list */}
          <div className="space-y-1.5">
            {[...inUse, ...idle].map((g, i) => {
              const total = requiredRoles(g.groupType, scope).length;
              const used = g.itemCount > 0;
              return (
                <div key={g.id}>
                  {!used && i === inUse.length && <div className={`${t.micro} px-1 pt-3 pb-1.5`}>Not in use yet</div>}
                  <button onClick={() => { setSel(g.id); setDraft({}); setErr(null); setOwnShared(false); }}
                    className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${g.id === sel ? "border-emerald-500/50 bg-emerald-500/5" : "border-stone-800 hover:border-stone-700 bg-stone-900/40"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={used ? t.bodyStrong : "text-[13px] font-medium text-stone-400"}>{g.name}</span>
                      {used && (g.missing.length ? <AlertTriangle size={14} className="text-amber-400 shrink-0" /> : <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />)}
                    </div>
                    <div className={`${t.hint} mt-0.5`}>
                      {used ? `${g.itemCount} item${g.itemCount === 1 ? "" : "s"}` : "No items"} · {total - g.missing.length} of {total} chosen
                    </div>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Role map */}
          {group && (
            <div className="rounded-lg border border-stone-800 bg-stone-900/40">
              <div className="px-4 py-3 border-b border-stone-800 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className={t.heading}>{group.name}</div>
                  <div className={t.hint}>
                    {GROUP_TYPE_META[group.groupType].label} group · {group.itemCount} item{group.itemCount === 1 ? "" : "s"}
                    {group.isDefault ? ` · every ${GROUP_TYPE_META[group.groupType].label.toLowerCase()} item without a group of its own posts here` : ""}
                  </div>
                </div>
              </div>
              <table className="w-full text-[13px]">
                <tbody>
                  {groupRoleSections(group.groupType, scope).map(section => ({ ...section, roles: section.roles.filter(x => !hiddenInGroup(group, x.role)) })).filter(section => section.roles.length).map(section => {
                    return [
                      <tr key={section.title}><td colSpan={2} className="px-4 pt-5 pb-1.5">
                        <div className={t.micro}>{section.title}</div>
                        <div className={`${t.hint} mt-0.5`}>{section.desc}</div>
                      </td></tr>,
                      ...section.roles.map(({ role: r, label }) => {
                        const value = draft[r] ?? group.roles[r] ?? "";
                        const bad = value ? roleAccountError(r, byId.get(value) as any) : null;
                        return (
                          <tr key={r} className="border-t border-stone-800/60">
                            <td className="px-4 py-2 align-top w-[42%]">
                              <div className="flex items-center gap-1.5">
                                <span className={t.bodyStrong}>{label}</span>
                                {(INVENTORY_ROLES as readonly string[]).includes(r) && <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 bg-stone-800 rounded px-1.5 py-px">control</span>}
                              </div>
                              <div className={t.hint} title={`${ROLES[r].purpose} · ${allowedTypesFor(r).join(" / ")}`}>{ROLE_REPORT_HINT[r]}</div>
                            </td>
                            <td className="px-4 py-2 align-top">
                              <SelectField value={value} disabled={!data.canEdit}
                                onChange={e => { if (e.target.value === "__add__") { setQuickAddRole(r); return; } setDraft(d => ({ ...d, [r]: e.target.value })); }}>
                                <option value="">{value ? "" : "— Not chosen —"}</option>
                                {optionsFor(r).map(a => <option key={a.id} value={a.id}>{acctLabel(a)}{a.source !== "native" ? ` (${a.source.toUpperCase()})` : ""}</option>)}
                                {value && !optionsFor(r).some(a => a.id === value) && <option value={value}>{acctLabel(byId.get(value)) || "(unknown account)"}</option>}
                                {data.canEdit && <option value="__add__">+ Add new account…</option>}
                              </SelectField>
                              {!value && group.itemCount > 0 && <p className="mt-1 text-[11px] text-amber-400">Not chosen. Items in this group can't move stock until it is.</p>}
                              {bad && <p className="mt-1 text-[11px] text-rose-400">{bad}</p>}
                            </td>
                          </tr>
                        );
                      }),
                    ];
                  })}
                </tbody>
              </table>
              {(() => {
                const hidden = SHARED_ROLES.filter(r => isRoleForGroupType(r, group.groupType) && hiddenInGroup(group, r));
                if (!hidden.length && !ownShared) return null;
                return (
                  <div className="px-4 py-3 border-t border-stone-800/60 text-[12px] text-stone-400 flex items-center gap-2 flex-wrap">
                    {hidden.length > 0
                      ? <span>Uses the shared accounts for {hidden.map(r => ROLES[r].label.toLowerCase()).join(", ")}.</span>
                      : <span>The shared accounts are listed above for this group.</span>}
                    {data.canEdit && (
                      <button className="text-stone-200 underline underline-offset-2 hover:text-white" onClick={() => setOwnShared(v => !v)}>
                        {ownShared ? "Hide them" : "Set separately for this group"}
                      </button>
                    )}
                  </div>
                );
              })()}
              {group.itemCount === 0 && (
                <div className="px-4 py-3 border-t border-stone-800/60 text-[12px] text-stone-400">
                  No items use this group yet, so nothing is blocked. Choose its accounts before you add {GROUP_TYPE_META[group.groupType].label.toLowerCase()} items.
                </div>
              )}
              {data.canEdit && dirty.length > 0 && (
                <div className="sticky bottom-0 border-t border-stone-800 bg-stone-900 px-4 py-3 flex items-center gap-3 flex-wrap">
                  <span className={t.secondary}>{dirty.length} change{dirty.length === 1 ? "" : "s"}</span>
                  {touchesStock && (
                    <label className="flex items-center gap-2 text-[12px] text-stone-400">
                      Effective date
                      <input type="date" value={effective} onChange={e => setEffective(e.target.value)} className={`${control} !w-40 !h-8`} />
                    </label>
                  )}
                  {err && <span className="text-[12px] text-rose-400 flex-1">{err}</span>}
                  <div className="ml-auto flex gap-2">
                    <Button variant="ghost" onClick={() => { setDraft({}); setErr(null); }}>Discard</Button>
                    <Button onClick={() => save(false)} disabled={saving || dirty.some(r => !draft[r])}>{saving ? "Saving…" : "Save mapping"}</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Move the balance?" size="sm" center
        footer={<div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button onClick={() => save(true)} disabled={saving}>{saving ? "Posting…" : "Post reclass and save"}</Button>
        </div>}>
        <div className="p-5">
        <p className={`${t.body} mb-3`}>The old account still holds stock value. Saving posts a reclass journal dated <b>{effective}</b> so the balance moves with the mapping:</p>
        <div className="space-y-2">
          {(confirm ?? []).map((r, i) => (
            <div key={i} className="rounded-md border border-stone-800 px-3 py-2">
              <div className={t.bodyStrong}>{ROLES[r.role].label}: {fmt.money(Math.abs(r.amount), ccy)}</div>
              <div className={t.hint}>{r.amount > 0 ? `${r.fromName} → ${r.toName}` : `${r.toName} → ${r.fromName}`} · {r.basis}</div>
            </div>
          ))}
        </div>
        </div>
      </Modal>

      {creating && <NewGroupDrawer onClose={() => setCreating(false)} onCreated={id => { setCreating(false); load(id); setToast({ message: "Group created from the default mapping", type: "success" }); }} />}
      {quickAddRole && (
        <QuickAdd kind="account" accountTypes={allowedTypesFor(quickAddRole)}
          onClose={() => { setQuickAddRole(null); setQuickAddShared(false); }}
          onCreated={(row) => {
            setData(d => d ? { ...d, accounts: [...d.accounts, row] } : d);
            if (quickAddShared) applyShared(quickAddRole, row.id);
            else setDraft(d => ({ ...d, [quickAddRole]: row.id }));
            setQuickAddRole(null); setQuickAddShared(false);
          }} />
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </ListPage>
  );
}

function NewGroupDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [groupType, setGroupType] = useState<GroupType>("RM");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setSaving(true); setErr(null);
    try {
      const res = await fetch("/api/accounting/posting-groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, groupType }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Could not create the group");
      onCreated(d.id);
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  }
  return (
    <Drawer title="New posting group" subtitle="Starts as a copy of the default group of the same type." onClose={onClose}
      footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Create group" err={err} saveDisabled={!name.trim()} />}>
      <div className="space-y-4">
        <Field label="Name" required hint='e.g. "Packaging" — raw material, with its own inventory account.'>
          <input className={controlInset} value={name} onChange={e => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Item type" required hint="Only items of this type can join the group.">
          <SelectField inset value={groupType} onChange={e => setGroupType(e.target.value as GroupType)}>
            {GROUP_TYPES.map(g => <option key={g} value={g}>{GROUP_TYPE_META[g].label}</option>)}
          </SelectField>
        </Field>
        <div className={`flex items-start gap-2 ${t.hint}`}><Layers size={14} className="mt-0.5 shrink-0" /> Remap its accounts after creating it; until then it posts exactly like the default group.</div>
      </div>
    </Drawer>
  );
}
