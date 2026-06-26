"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, Check, Loader } from "lucide-react";
import { MailboxConnect } from "@/components/mailbox-connect";

function SchedulingLink() {
  const [url, setUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/profile").then(r => r.ok ? r.json() : null).then(d => { setUrl(d?.schedulingUrl ?? ""); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      const r = await fetch("/api/admin/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schedulingUrl: url }) });
      if (r.ok) { const d = await r.json(); setUrl(d.schedulingUrl ?? ""); setSaved(true); setTimeout(() => setSaved(false), 2000); }
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-5 mt-5">
      <div className="flex items-center gap-2 mb-1">
        <CalendarCheck size={16} className="text-stone-400" />
        <h2 className="text-sm font-semibold text-white">Scheduling link</h2>
      </div>
      <p className="text-xs text-stone-500 mb-3">Your Calendly (or similar) booking link. The <span className="text-stone-300">Book</span> action on any account opens this so prospects can self-schedule with you.</p>
      <div className="flex items-center gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)} disabled={!loaded}
          placeholder="https://calendly.com/your-name/intro"
          className="flex-1 h-9 px-3 text-sm rounded-lg bg-stone-800 border border-stone-700 text-stone-200 placeholder-stone-600 focus:outline-none focus:border-emerald-500" />
        <button onClick={save} disabled={saving || !loaded}
          className="h-9 px-4 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60 flex items-center gap-1.5">
          {saving ? <Loader size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null} {saved ? "Saved" : "Save"}
        </button>
      </div>
    </div>
  );
}

export default function EmailIntegrationPage() {
  return (
    <div className="max-w-3xl mx-auto py-2">
      <MailboxConnect />
      <SchedulingLink />
    </div>
  );
}
