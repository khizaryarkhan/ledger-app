"use client";

/**
 * "Views" menu for a report: pick one of your saved choices of period / columns / compare-to, save the
 * current choice under a name, or delete one. Generic: the report passes its own `reportKey`, the settings
 * it wants remembered (`current`) and what to do with a stored view (`onApply`). The report must re-check
 * every stored value against its own options before applying it — a stored view is untrusted input.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, Check, Trash2 } from "lucide-react";
import { control } from "@/components/form-kit";
import { askConfirm } from "@/lib/dialogs";
import { nameKey, type ViewParams } from "@/lib/reports/saved-views";

interface SavedView { id: string; name: string; params: ViewParams }

export function SavedViewsMenu({ reportKey, current, onApply }: {
  reportKey: string; current: ViewParams; onApply: (params: ViewParams) => void;
}) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    fetch(`/api/accounting/report-views?reportKey=${encodeURIComponent(reportKey)}`)
      .then((r) => r.json())
      .then((j) => { if (Array.isArray(j?.views)) setViews(j.views); })
      .catch(() => { /* the menu still works for saving; the list fills on the next open */ });
  }, [reportKey]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function save() {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean) { setMsg("Give the view a name."); return; }
    const replacing = views.some((v) => nameKey(v.name) === nameKey(clean));
    if (replacing && !(await askConfirm(`Replace your saved view "${clean}" with the current settings?`))) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/accounting/report-views", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportKey, name: clean, params: current }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(j?.error || "Could not save the view."); return; }
      setName(""); setMsg(j.replaced ? "View updated." : "View saved."); load();
    } catch { setMsg("Network problem. Try again."); }
    finally { setBusy(false); }
  }

  async function remove(v: SavedView) {
    if (!(await askConfirm(`Delete your saved view "${v.name}"?`))) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/accounting/report-views?id=${encodeURIComponent(v.id)}`, { method: "DELETE" });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setMsg(j?.error || "Could not delete the view."); }
      load();
    } catch { setMsg("Network problem. Try again."); }
    finally { setBusy(false); }
  }

  return (
    <div className="relative shrink-0" ref={root}>
      <button
        type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}
        className="h-8 px-3 text-[12px] rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 hover:text-stone-100 inline-flex items-center gap-1.5"
      ><Bookmark size={13} /> Views{views.length > 0 ? ` (${views.length})` : ""}</button>
      {open && (
        <div role="menu" className="absolute left-0 mt-1 w-72 rounded-lg bg-stone-900 ring-1 ring-stone-700 shadow-lg z-30 p-2">
          {views.length === 0 ? (
            <p className="px-2 py-1.5 text-[12px] text-stone-400">No saved views yet. Set up the report, then save it below.</p>
          ) : (
            <ul className="max-h-56 overflow-y-auto mb-2">
              {views.map((v) => (
                <li key={v.id} className="flex items-center gap-1 rounded hover:bg-stone-800">
                  <button type="button" role="menuitem" onClick={() => { onApply(v.params); setOpen(false); }}
                    className="flex-1 min-w-0 text-left px-2 py-1.5 text-[12px] text-stone-200 truncate" title={v.name}>{v.name}</button>
                  <button type="button" onClick={() => remove(v)} disabled={busy} aria-label={`Delete ${v.name}`}
                    className="p-1.5 text-stone-500 hover:text-rose-300 disabled:opacity-40"><Trash2 size={12} /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-stone-800 pt-2 flex items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Name this view"
              onKeyDown={(e) => { if (e.key === "Enter") save(); }} className={`${control} h-8 text-[12px] flex-1 min-w-0`} />
            <button type="button" onClick={save} disabled={busy}
              className="h-8 px-2.5 rounded-md ring-1 ring-stone-700 bg-stone-800 text-[12px] text-stone-200 hover:text-white inline-flex items-center gap-1 disabled:opacity-50">
              <Check size={12} /> Save
            </button>
          </div>
          {msg && <p className="px-1 pt-1.5 text-[11px] text-stone-400">{msg}</p>}
        </div>
      )}
    </div>
  );
}
