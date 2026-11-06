"use client";

/**
 * My Details — a person keeps their own personal, emergency-contact and bank
 * details up to date. Works in both the app shell and the employee portal
 * (ReportShell handles either), and talks only to
 * /api/resources/me/personal-details, which finds the person from the session.
 * Employment fields are shown read-only: they are the administrator's.
 */
import { useState } from "react";
import { Check, Loader } from "lucide-react";
import { ReportShell, type ReportShellKind } from "@/components/resource-report-shell";
import { usePersonDetails, PersonalTab, EmergencyTab, BankTab } from "@/components/person-details-tabs";

type Tab = "personal" | "emergency" | "bank";
const TABS: { key: Tab; label: string }[] = [
  { key: "personal", label: "Personal" },
  { key: "emergency", label: "Emergency contact" },
  { key: "bank", label: "Bank" },
];

export function MyDetails({ shell }: { shell: ReportShellKind }) {
  const hook = usePersonDetails(undefined, "/api/resources/me/personal-details");
  const [tab, setTab] = useState<Tab>("personal");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaving(true); setMsg(null);
    const err = await hook.save();
    setSaving(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: "Saved." });
  }

  const ready = hook.state.loaded && !hook.state.error;
  const saveBar = ready ? (
    <div className="flex items-center gap-3">
      {msg && <span className={msg.ok ? "text-[12px] text-emerald-400" : "text-[12px] text-rose-400"}>{msg.text}</span>}
      <button onClick={save} disabled={saving || !hook.state.dirty}
        className="h-8 inline-flex items-center gap-1.5 text-[12px] font-semibold bg-emerald-600 text-white rounded-md px-3 hover:bg-emerald-700 disabled:opacity-50">
        {saving ? <Loader size={13} className="animate-spin" /> : <Check size={13} />} Save changes
      </button>
    </div>
  ) : undefined;

  return (
    <ReportShell shell={shell} title="My Details"
      subtitle="Your contact, emergency contact and bank details. Bank and ID numbers are stored encrypted; only the last four characters are ever shown back."
      actions={saveBar}>
      <div className="max-w-[760px] space-y-5">
        <div className="flex gap-1.5 flex-wrap" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={tab === t.key
                ? "h-8 px-3 text-[12px] font-medium rounded-md ring-1 ring-stone-600 bg-stone-700 text-stone-100"
                : "h-8 px-3 text-[12px] font-medium rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-400 hover:text-stone-200"}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="rounded-lg ring-1 ring-stone-800 bg-stone-900 p-5">
          {tab === "personal" && <PersonalTab hook={hook} lockEmployment />}
          {tab === "emergency" && <EmergencyTab hook={hook} />}
          {tab === "bank" && <BankTab hook={hook} />}
        </div>
      </div>
    </ReportShell>
  );
}
