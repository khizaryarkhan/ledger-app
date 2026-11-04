"use client";

// The organisation's AI-connection switches (Settings → AI connections). An org
// admin can stop every AI connection from changing or deleting anything, at once,
// whatever each connection was granted. Everyone else sees the current state.

import { useEffect, useState } from "react";
import { Power } from "lucide-react";
import { Card } from "@/components/ui";

type Switches = { writes: boolean; deletes: boolean; canEdit: boolean };

type ToggleProps = { on: boolean; disabled: boolean; onChange: (v: boolean) => void; label: string };

function Toggle({ on, disabled, onChange, label }: ToggleProps) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={() => onChange(!on)}
      className={on
        ? "h-5 w-9 rounded-full bg-emerald-500 relative transition-colors disabled:opacity-50"
        : "h-5 w-9 rounded-full bg-stone-700 relative transition-colors disabled:opacity-50"}
    >
      <span className={on
        ? "absolute top-0.5 left-[18px] h-4 w-4 rounded-full bg-white transition-all"
        : "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-all"} />
    </button>
  );
}

export function AiSwitches() {
  const [s, setS] = useState<Switches | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/mcp/settings", { cache: "no-store", signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw new Error(); setS(await r.json()); })
      .catch((e) => { if (e?.name !== "AbortError") setErr("Could not load the organisation's AI switches."); });
    return () => controller.abort();
  }, []);

  const save = async (patch: Partial<Pick<Switches, "writes" | "deletes">>) => {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/mcp/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not save.");
      setS((prev) => (prev ? { ...prev, ...d } : prev));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const deleteLabelClass = s?.writes ? "text-[13px] text-stone-200" : "text-[13px] text-stone-500";

  return (
    <Card className="p-5 mb-5">
      <div className="flex items-start gap-3">
        <Power size={18} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h2 className="text-[13px] font-semibold text-white">Organisation switches</h2>
          <p className="text-[13px] text-stone-400 mt-1">
            Applies to every AI connection in this organisation, including QuickBooks changes. Reading is never affected.
            {s && !s.canEdit && " Only an organisation admin can change these."}
          </p>
          {err && <p className="text-[13px] text-red-400 mt-2" role="alert">{err}</p>}
          {s && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-stone-200">AI connections may create and change data</span>
                <Toggle label="Allow AI changes" on={s.writes} disabled={!s.canEdit || busy} onChange={(v) => save({ writes: v })} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className={deleteLabelClass}>AI connections may delete data</span>
                <Toggle label="Allow AI deletes" on={s.deletes && s.writes} disabled={!s.canEdit || busy || !s.writes} onChange={(v) => save({ deletes: v })} />
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
