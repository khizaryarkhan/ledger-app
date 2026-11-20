"use client";

/**
 * The ISO 3166-1 alpha-2 code of one entry in the org's own country list (Settings → Team → Countries). EDI orders
 * carry the code, not the name, so a name that matched no code (a spelling the list does not know) can be fixed here.
 * Saves on blur through PATCH /api/countries, which validates the code against the ISO list. Admins edit; others read.
 */

import { useState } from "react";

export function CountryIsoField({ id, code, editable, onSaved }: { id: string; code: string | null; editable: boolean; onSaved: () => void }) {
  const [v, setV] = useState(code ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (!editable) return <span className="font-mono text-[11px] text-stone-400" title="ISO 3166-1 code">{code ?? "no code"}</span>;

  async function save() {
    const next = v.trim().toUpperCase();
    if (next === (code ?? "")) { setErr(""); return; }
    setBusy(true); setErr("");
    const r = await fetch("/api/countries", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, isoCode: next || null }) });
    setBusy(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save the code."); return; }
    setV(next);
    onSaved();
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        value={v} onChange={e => setV(e.target.value.toUpperCase().slice(0, 2))} onBlur={save}
        onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        disabled={busy} maxLength={2} placeholder="—" aria-label="ISO country code" title="ISO 3166-1 alpha-2 code, sent on EDI orders"
        className={`h-6 w-10 text-center font-mono text-[11px] rounded bg-stone-950 ring-1 ${err ? "ring-rose-700" : v ? "ring-stone-700" : "ring-amber-700/70"} text-stone-200 focus:outline-none focus:ring-stone-500`}
      />
      {err && <span className="text-[11px] text-rose-400">{err}</span>}
    </span>
  );
}
