"use client";

/**
 * Stock Locations — the master list of physical places inventory sits.
 *
 * Visibility is the point of this screen: every location shows what it is
 * currently holding, because that is the fact which decides whether it can be
 * deactivated or deleted. Telling someone "this location still holds stock"
 * only after they click Delete is a worse experience than showing the quantity
 * next to the button all along.
 */

import { useEffect, useMemo, useState } from "react";
import { MapPin, Plus, Pencil, Trash2, Star, Loader2, AlertTriangle } from "lucide-react";
import { Button, Badge, Card, Modal, EmptyState, Toast } from "@/components/ui";
import { Field, SelectField, Section, control, th } from "@/components/form-kit";

type LocationType = { value: string; label: string; hint: string };

type Location = {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  isDefault: boolean;
  status: string;
  address: string | null;
  note: string | null;
  onHandQty: number;
  lotCount: number;
};

const blank = {
  code: "", name: "", type: "Store", parentId: "",
  address: "", note: "", status: "Active", isDefault: false,
};

export function LocationRegister() {
  const [rows, setRows] = useState<Location[]>([]);
  const [types, setTypes] = useState<LocationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...blank });
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<any>(null);

  const say = (message: string, type = "success") => setToast({ message, type });

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/inventory/locations");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load locations");
      setRows(data.locations ?? []);
      setTypes(data.types ?? []);
    } catch (e: any) {
      say(e.message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const open = (row: Location | null) => {
    setFormError(null);
    if (row) {
      setEditing(row);
      setForm({
        code: row.code, name: row.name, type: row.type,
        parentId: row.parentId ?? "", address: row.address ?? "",
        note: row.note ?? "", status: row.status, isDefault: row.isDefault,
      });
    } else {
      setEditing(null);
      setCreating(true);
      setForm({ ...blank });
    }
  };

  const close = () => { setEditing(null); setCreating(false); setFormError(null); };

  async function save() {
    setSaving(true);
    setFormError(null);
    try {
      const body = { ...form, parentId: form.parentId || null };
      const res = await fetch(
        editing ? `/api/inventory/locations/${editing.id}` : "/api/inventory/locations",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not save the location");
      say(editing ? "Location updated" : "Location created");
      close();
      load();
    } catch (e: any) {
      // Inline, not a toast: the message names the field or the blocking
      // condition, so it belongs next to the form the person is looking at.
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: Location) {
    if (!confirm(`Delete "${row.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/inventory/locations/${row.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not delete the location");
      say("Location deleted");
      load();
    } catch (e: any) {
      say(e.message, "error");
    }
  }

  async function makeDefault(row: Location) {
    try {
      const res = await fetch(`/api/inventory/locations/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not set the default");
      say(`"${row.name}" is now the default location`);
      load();
    } catch (e: any) {
      say(e.message, "error");
    }
  }

  const typeLabel = (v: string) => types.find(t => t.value === v)?.label ?? v;
  const parents = useMemo(
    () => rows.filter(r => r.id !== editing?.id && r.status === "Active"),
    [rows, editing],
  );
  const activeHint = types.find(t => t.value === form.type)?.hint;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-stone-100 flex items-center gap-2">
            <MapPin size={18} className="text-orange-400" /> Stock Locations
          </h1>
          <p className="text-sm text-stone-400 mt-1">
            The physical places stock sits. Receipts land in one, shipments leave from one,
            and a transfer moves stock between them without changing what it cost.
          </p>
        </div>
        <Button icon={Plus} onClick={() => open(null)}>New location</Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-stone-500 py-10 justify-center">
          <Loader2 size={15} className="animate-spin" /> Loading locations…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No stock locations yet"
          description="Add the places you actually keep stock — a raw material store, the production floor, a finished goods warehouse. The first one you add becomes the default."
          action={<Button icon={Plus} onClick={() => open(null)}>New location</Button>}
        />
      ) : (
        <Card padding="none">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-800">
              <tr>
                <th className={th}>Code</th>
                <th className={th}>Name</th>
                <th className={th}>Type</th>
                <th className={th}>Inside</th>
                <th className={`${th} text-right`}>On hand</th>
                <th className={`${th} text-right`}>Lots</th>
                <th className={th}>Status</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const parent = rows.find(p => p.id === r.parentId);
                return (
                  <tr key={r.id} className="border-b border-stone-800/60 last:border-0 hover:bg-stone-900/40">
                    <td className="px-2.5 py-2.5 font-mono text-[12px] text-stone-300">{r.code}</td>
                    <td className="px-2.5 py-2.5 text-stone-200">
                      <span className="inline-flex items-center gap-1.5">
                        {r.name}
                        {r.isDefault && (
                          <span title="Receipts with no location chosen land here">
                            <Badge variant="emerald" size="xs">Default</Badge>
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-2.5 py-2.5 text-stone-400">{typeLabel(r.type)}</td>
                    <td className="px-2.5 py-2.5 text-stone-500">{parent?.name ?? "—"}</td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums text-stone-200">
                      {r.onHandQty ? r.onHandQty.toLocaleString() : <span className="text-stone-600">—</span>}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums text-stone-500">
                      {r.lotCount || <span className="text-stone-600">—</span>}
                    </td>
                    <td className="px-2.5 py-2.5">
                      {r.status === "Active"
                        ? <span className="text-stone-400">Active</span>
                        : <Badge variant="neutral" size="xs">Inactive</Badge>}
                    </td>
                    <td className="px-2.5 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {!r.isDefault && r.status === "Active" && (
                          <button
                            onClick={() => makeDefault(r)}
                            title="Make this the default location"
                            className="p-1.5 rounded-md text-stone-500 hover:text-amber-400 hover:bg-stone-800"
                          >
                            <Star size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => open(r)}
                          title="Edit"
                          className="p-1.5 rounded-md text-stone-500 hover:text-stone-200 hover:bg-stone-800"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => remove(r)}
                          title={
                            r.isDefault ? "The default location cannot be deleted"
                              : r.onHandQty > 0 ? `Holds ${r.onHandQty.toLocaleString()} unit(s) — transfer them out first`
                              : "Delete"
                          }
                          disabled={r.isDefault || r.onHandQty > 0}
                          className="p-1.5 rounded-md text-stone-500 hover:text-rose-400 hover:bg-stone-800 disabled:opacity-30 disabled:hover:text-stone-500 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={creating || !!editing}
        onClose={close}
        title={editing ? `Edit ${editing.name}` : "New stock location"}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create location"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[12px] text-rose-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <Section title="Identity">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Code" required hint="Used on picking lists" className="col-span-1">
                <input
                  className={control}
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                  placeholder="RM-01"
                  maxLength={32}
                />
              </Field>
              <Field label="Name" required className="col-span-2">
                <input
                  className={control}
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Raw Material Store"
                />
              </Field>
            </div>
          </Section>

          <Section title="Behaviour">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type" hint={activeHint}>
                <SelectField
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                >
                  {types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </SelectField>
              </Field>
              <Field label="Inside" hint="Optional — a site this sits within">
                <SelectField
                  value={form.parentId}
                  onChange={e => setForm(f => ({ ...f, parentId: e.target.value }))}
                >
                  <option value="">—</option>
                  {parents.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </SelectField>
              </Field>
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))}
                className="mt-0.5 accent-emerald-500"
              />
              <span className="text-[12px] text-stone-300">
                Make this the default location
                <span className="block text-[11px] text-stone-500">
                  Stock recorded without a location chosen lands here. Exactly one location is the default.
                </span>
              </span>
            </label>

            {editing && (
              <Field label="Status" hint={
                editing.isDefault ? "The default location cannot be deactivated."
                  : editing.onHandQty > 0 ? `Holds ${editing.onHandQty.toLocaleString()} unit(s) — transfer them out before deactivating.`
                  : undefined
              }>
                <SelectField
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  disabled={editing.isDefault}
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </SelectField>
              </Field>
            )}
          </Section>

          <Section title="Details">
            <Field label="Address">
              <textarea
                className={control}
                rows={2}
                value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              />
            </Field>
            <Field label="Note">
              <textarea
                className={control}
                rows={2}
                value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              />
            </Field>
          </Section>
        </div>
      </Modal>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
