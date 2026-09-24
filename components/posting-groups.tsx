"use client";

/**
 * Posting Groups — the Chart of Accounts mapping for inventory.
 *
 * Every stock posting names a ROLE; the item's posting group says which
 * account plays it. This screen is where that mapping is set, per group, with
 * each dropdown offering only accounts of the type the role requires. A
 * tracked item whose group has any role unmapped cannot move stock, so an
 * incomplete group is shown as the blocker it is.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Plus, Sparkles, Layers } from "lucide-react";
import { ListPage, ListPageHeader } from "@/components/list-view";
import { Button, Modal, Toast } from "@/components/ui";
import { Drawer, DrawerFooter, Field, SelectField, controlInset, control, t } from "@/components/form-kit";
import {
  ACCOUNT_ROLES, ROLES, ROLE_SECTIONS, GROUP_TYPES, GROUP_TYPE_META, INVENTORY_ROLES,
  allowedTypesFor, roleAccountError, type AccountRole, type GroupType,
} from "@/lib/accounting/account-roles";
import { fmt, localToday } from "@/lib/format";
import { useData } from "@/components/data-provider";

type Acct = { id: string; name: string; code: string | null; type: string | null; status: string; isHeader: boolean; defaultRole: string | null; source: string };
type Group = { id: string; name: string; groupType: GroupType; isDefault: boolean; roles: Partial<Record<AccountRole, string>>; itemCount: number; missing: AccountRole[] };
type Reclass = { role: AccountRole; fromAccountId: string; toAccountId: string; amount: number; basis: string; fromName: string; toName: string };

const acctLabel = (a?: Acct) => a ? `${a.code ? a.code + " · " : ""}${a.name}` : "";

export function PostingGroups() {
  const { orgSettings } = useData() as any;
  const ccy = orgSettings?.currency ?? "EUR";
  const [data, setData] = useState<{ synced: boolean; canEdit: boolean; groups: Group[]; accounts: Acct[] } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Record<AccountRole, string>>>({});
  const [effective, setEffective] = useState(localToday());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Reclass[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<any>(null);

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
  const anyMissing = (data?.groups ?? []).some(g => g.missing.length);

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
        {anyMissing && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-200 flex gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>Some groups have roles with no account. Items in those groups can't be received, built, shipped or transferred until every role is mapped.</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          {/* Group list */}
          <div className="space-y-1.5">
            {data.groups.map(g => (
              <button key={g.id} onClick={() => { setSel(g.id); setDraft({}); setErr(null); }}
                className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${g.id === sel ? "border-emerald-500/50 bg-emerald-500/5" : "border-stone-800 hover:border-stone-700 bg-stone-900/40"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={t.bodyStrong}>{g.name}</span>
                  {g.missing.length ? <AlertTriangle size={14} className="text-amber-400 shrink-0" /> : <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />}
                </div>
                <div className={`${t.hint} mt-0.5`}>
                  {GROUP_TYPE_META[g.groupType].label}{g.isDefault ? " · default" : ""} · {g.itemCount} item{g.itemCount === 1 ? "" : "s"}
                  {g.missing.length ? ` · ${g.missing.length} unmapped` : ""}
                </div>
              </button>
            ))}
          </div>

          {/* Role map */}
          {group && (
            <div className="rounded-lg border border-stone-800 bg-stone-900/40">
              <div className="px-4 py-3 border-b border-stone-800 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className={t.heading}>{group.name}</div>
                  <div className={t.hint}>
                    {GROUP_TYPE_META[group.groupType].label} items post their stock to <b className="text-stone-300">{ROLES[GROUP_TYPE_META[group.groupType].inventoryRole].label}</b>,
                    {" "}sales to <b className="text-stone-300">{ROLES[GROUP_TYPE_META[group.groupType].salesRole].label}</b> and cost of sales to <b className="text-stone-300">{ROLES[GROUP_TYPE_META[group.groupType].cogsRole].label}</b>.
                  </div>
                </div>
              </div>
              <table className="w-full text-[13px]">
                <tbody>
                  {ROLE_SECTIONS.map(section => {
                    const roles = ACCOUNT_ROLES.filter(r => ROLES[r].section === section);
                    return [
                      <tr key={section}><td colSpan={2} className={`${t.micro} px-4 pt-4 pb-1.5`}>{section}</td></tr>,
                      ...roles.map(r => {
                        const value = draft[r] ?? group.roles[r] ?? "";
                        const used = r === GROUP_TYPE_META[group.groupType].inventoryRole || r === GROUP_TYPE_META[group.groupType].salesRole || r === GROUP_TYPE_META[group.groupType].cogsRole;
                        const bad = value ? roleAccountError(r, byId.get(value) as any) : null;
                        return (
                          <tr key={r} className="border-t border-stone-800/60">
                            <td className="px-4 py-2 align-top w-[42%]">
                              <div className="flex items-center gap-1.5">
                                <span className={t.bodyStrong}>{ROLES[r].label}</span>
                                {used && <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400/90 bg-emerald-500/10 rounded px-1.5 py-px">this group</span>}
                                {(INVENTORY_ROLES as readonly string[]).includes(r) && <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 bg-stone-800 rounded px-1.5 py-px">control</span>}
                              </div>
                              <div className={t.hint}>{ROLES[r].purpose} · {allowedTypesFor(r).join(" / ")}</div>
                            </td>
                            <td className="px-4 py-2 align-top">
                              <SelectField value={value} disabled={!data.canEdit}
                                onChange={e => setDraft(d => ({ ...d, [r]: e.target.value }))}>
                                <option value="">{value ? "" : "— Not mapped —"}</option>
                                {optionsFor(r).map(a => <option key={a.id} value={a.id}>{acctLabel(a)}{a.source !== "native" ? ` (${a.source.toUpperCase()})` : ""}</option>)}
                                {value && !optionsFor(r).some(a => a.id === value) && <option value={value}>{acctLabel(byId.get(value)) || "(unknown account)"}</option>}
                              </SelectField>
                              {!value && <p className="mt-1 text-[11px] text-amber-400">Not mapped — blocks stock movements for this group.</p>}
                              {bad && <p className="mt-1 text-[11px] text-rose-400">{bad}</p>}
                            </td>
                          </tr>
                        );
                      }),
                    ];
                  })}
                </tbody>
              </table>
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
