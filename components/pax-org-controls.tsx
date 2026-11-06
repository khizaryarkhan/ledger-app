"use client";

// Admin controls for PAX Console: which AI providers the organisation allows, whether a
// user may point it at their own endpoint, whether a model may propose changes (each still
// needs the user's click), and the notice every user accepts before chatting.
// The rules are enforced on the server (settings and chat routes), not only here.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Field, Section, control } from "@/components/form-kit";
import { DEFAULT_CONSENT } from "@/lib/pax/policy";
import { PROVIDERS } from "@/lib/pax/providers";

const READY = PROVIDERS.filter((p) => p.ready);
const GROUPS = Array.from(new Set(READY.map((p) => p.group)));
const box = "h-4 w-4 accent-emerald-500";

export function PaxOrgControls({ onSaved }: { onSaved?: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [allowAll, setAllowAll] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState(true);
  const [writes, setWrites] = useState(false);
  const [consent, setConsent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/pax-console/policy").then((r) => r.json()).then((j) => {
      const p = j.policy;
      setAllowAll(!p.allowedProviders);
      setPicked(new Set(p.allowedProviders ?? []));
      setCustom(p.allowCustomEndpoints);
      setWrites(p.writesEnabled);
      setConsent(p.consentText ?? "");
      setLoaded(true);
    }).catch(() => setError("Could not load the current rules."));
  }, []);

  function toggle(id: string) {
    setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function save() {
    setError(null);
    setNotice(null);
    if (!allowAll && picked.size === 0) return setError("Pick at least one provider, or allow all of them.");
    setBusy(true);
    try {
      const res = await fetch("/api/pax-console/policy", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowedProviders: allowAll ? null : [...picked], allowCustomEndpoints: custom, writesEnabled: writes, consentText: consent.trim() || null }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) return setError(j?.error || "That did not save. Try again.");
      setNotice("Saved. It applies to everyone in your organisation from their next message.");
      onSaved?.();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <div className="flex-1 px-6 py-6 text-[13px] text-stone-500">{error ?? "Loading"}</div>;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-xl space-y-8">
        <Section title="Providers" desc="Which AI providers people in your organisation may connect. A model someone already saved stops working if it is no longer allowed.">
          <label className="flex items-center gap-2 text-[13px] text-stone-200">
            <input type="checkbox" className={box} checked={allowAll} onChange={(e) => setAllowAll(e.target.checked)} />Allow every provider
          </label>
          {!allowAll && GROUPS.map((g) => (
            <fieldset key={g} className="space-y-1.5">
              <legend className="text-[11px] font-medium uppercase tracking-wider text-stone-500 mb-1">{g}</legend>
              <div className="grid grid-cols-2 gap-1.5">
                {READY.filter((p) => p.group === g).map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-[13px] text-stone-300">
                    <input type="checkbox" className={box} checked={picked.has(p.id)} onChange={() => toggle(p.id)} />{p.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <label className="flex items-center gap-2 text-[13px] text-stone-200">
            <input type="checkbox" className={box} checked={custom} onChange={(e) => setCustom(e.target.checked)} />Allow people to type their own endpoint address
          </label>
        </Section>

        <Section title="Changes" desc="Off by default. When on, a capable model may propose a change, which appears as a card. Nothing happens until the person presses Apply, and it runs with their own permissions. Deleting, changing QuickBooks or Xero, and sending email stay unavailable.">
          <label className="flex items-center gap-2 text-[13px] text-stone-200">
            <input type="checkbox" className={box} checked={writes} onChange={(e) => setWrites(e.target.checked)} />Let models propose changes
          </label>
          <p className="text-[12px] text-stone-500">Also requires the organisation's AI write switch in Settings → AI connections to be on.</p>
        </Section>

        <Section title="Data notice" desc="Shown once to each person before they can chat.">
          <Field label="Notice text" htmlFor="pax-consent" hint="Leave blank to use the standard wording.">
            <textarea id="pax-consent" rows={5} className={control} value={consent} onChange={(e) => setConsent(e.target.value)} placeholder={DEFAULT_CONSENT} />
          </Field>
        </Section>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={busy}
            className="h-8 px-3 rounded-lg bg-primary hover:bg-primary-hover text-white text-[13px] font-medium disabled:opacity-50 inline-flex items-center gap-2">
            {busy && <Loader2 size={14} className="animate-spin" />}Save rules
          </button>
          {notice && <span className="text-[12px] text-emerald-400">{notice}</span>}
          {error && <span className="text-[12px] text-red-400">{error}</span>}
        </div>
      </div>
    </div>
  );
}
