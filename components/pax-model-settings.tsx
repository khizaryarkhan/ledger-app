"use client";

// "Your model": where a user connects the AI model PAX Console talks to. The key
// goes to the server once, is tested, and is stored encrypted; this screen only
// ever shows its last four characters back.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Field, Section, SelectField, control } from "@/components/form-kit";
import { PROVIDERS, providerById } from "@/lib/pax/providers";
import type { PublicModel } from "@/lib/pax/keys";

const GROUPS = Array.from(new Set(PROVIDERS.map((p) => p.group)));

export function PaxModelSettings({ model, onChange, allowedProviders = null }: { model: PublicModel | null; onChange: (m: PublicModel | null) => void; allowedProviders?: string[] | null }) {
  const allowed = (id: string) => !allowedProviders || allowedProviders.includes(id);
  const start = providerById(model?.provider) ?? providerById("anthropic")!;
  const [providerId, setProviderId] = useState(start.id);
  const [modelName, setModelName] = useState(model?.model ?? start.models[0] ?? "");
  const [baseUrl, setBaseUrl] = useState(model?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const provider = providerById(providerId)!;

  function pickProvider(id: string) {
    const next = providerById(id);
    if (!next) return;
    setProviderId(id);
    setModelName(next.models[0] ?? "");
    setBaseUrl("");
    setError(null);
    setNotice(null);
  }

  async function save() {
    setError(null);
    setNotice(null);
    if (provider.needsBaseUrl && !baseUrl.trim()) return setError("Enter the endpoint address.");
    if (!modelName.trim()) return setError("Enter a model name.");
    if (!model && !apiKey.trim()) return setError("Paste your API key.");
    setBusy(true);
    try {
      const res = await fetch("/api/pax-console/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: providerId, model: modelName.trim(), baseUrl: provider.needsBaseUrl ? baseUrl.trim() : null, apiKey: apiKey.trim() || undefined }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) return setError(j?.error || "That did not work. Check the details and try again.");
      setApiKey("");
      onChange(j.model);
      setNotice(`Saved. Your key ends in ${j.model.keyLast4} and cannot be shown again.`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirmRemove) return setConfirmRemove(true);
    setBusy(true);
    try {
      const res = await fetch("/api/pax-console/settings", { method: "DELETE" });
      if (res.ok) { onChange(null); setApiKey(""); setNotice("Your model and key were removed."); }
      else setError("Could not remove it. Try again.");
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-xl space-y-8">
        <Section title="Your model" desc="PAX Console uses the AI model you choose, with your own key. Your key is encrypted, never shown again, and used only for your chats.">
          <p className={`text-[13px] ${model ? "text-emerald-400" : "text-stone-400"}`}>
            {model ? `Connected: ${providerById(model.provider)?.label ?? model.provider}, ${model.model}, key ending ${model.keyLast4}` : "Not connected yet."}
          </p>

          <Field label="Provider" htmlFor="pax-provider">
            <SelectField id="pax-provider" value={providerId} onChange={(e) => pickProvider(e.target.value)}>
              {GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {PROVIDERS.filter((p) => p.group === g).map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.ready || !allowed(p.id)}>{p.label}{!p.ready ? " (planned)" : allowed(p.id) ? "" : " (not allowed by your admin)"}</option>
                  ))}
                </optgroup>
              ))}
            </SelectField>
          </Field>

          {provider.needsBaseUrl && (
            <Field label="Endpoint address" htmlFor="pax-url" hint="Must start with https://. The address must be reachable from the internet.">
              <input id="pax-url" className={control} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-server/v1" autoComplete="off" />
            </Field>
          )}

          <Field label="Model" htmlFor="pax-model" hint="Pick a suggestion or type any model name your provider offers.">
            <input id="pax-model" list="pax-models" className={control} value={modelName} onChange={(e) => setModelName(e.target.value)} autoComplete="off" />
            <datalist id="pax-models">{provider.models.map((m) => <option key={m} value={m} />)}</datalist>
          </Field>

          <Field label="API key" htmlFor="pax-key" hint={model ? "Leave blank to keep the key you saved." : undefined} error={error}>
            <input id="pax-key" type="password" className={control} value={apiKey} onChange={(e) => { setApiKey(e.target.value); setError(null); }} autoComplete="off" placeholder={model ? "Saved key stays in use" : "Paste your key"} />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={busy}
              className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[13px] font-medium disabled:opacity-50 inline-flex items-center gap-2">
              {busy && <Loader2 size={14} className="animate-spin" />}Save and test
            </button>
            {model && (
              <button type="button" onClick={remove} disabled={busy}
                className="h-8 px-3 rounded-lg text-[13px] text-stone-400 hover:text-red-400 hover:bg-stone-800 disabled:opacity-50">
                {confirmRemove ? "Click again to remove your key" : "Remove model and key"}
              </button>
            )}
            {notice && <span className="text-[12px] text-emerald-400">{notice}</span>}
          </div>
        </Section>

        <Section title="Where your data goes">
          <p className="text-[13px] leading-relaxed text-stone-400">
            When you chat, your question and the records needed to answer it are sent to <span className="text-stone-200">{provider.label}</span>, using your own account.
            Prime Accountax does not pay for or store your conversations with {provider.label}. Personal identifiers, bank details and credentials are removed before anything is sent.
            You can read and change only what your role in Prime Accountax already allows. A change is only ever a card you review and apply, and only if your admin has allowed it.
          </p>
        </Section>
      </div>
    </div>
  );
}
