"use client";

// A change the model PROPOSED. It shows exactly what would be sent (the stored request,
// not just the model's description of it) and nothing happens until the person presses
// Apply. Applying runs it on the server as them, so their own permissions decide.

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import type { UiAction } from "@/lib/pax/ui-shape";

const PAST: Record<string, string> = {
  applied: "Applied",
  rejected: "Rejected",
  expired: "Expired. Ask again for a fresh card.",
  failed: "Failed",
  running: "Running",
};

/** The query exactly as the server sends it: objects as JSON, null and undefined left out. */
function queryString(query: unknown): string {
  if (!query || typeof query !== "object") return "";
  const pairs = Object.entries(query as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)] as [string, string]);
  return pairs.length ? `?${new URLSearchParams(pairs).toString()}` : "";
}

const BODY_PREVIEW = 900;
function bodyText(body: unknown): string {
  if (body === null || body === undefined) return "";
  const t = JSON.stringify(body, null, 2);
  return t.length > BODY_PREVIEW ? `${t.slice(0, BODY_PREVIEW)}\n… (${t.length - BODY_PREVIEW} more characters)` : t;
}

export function PaxActionCard({ action }: { action: UiAction }) {
  const [status, setStatus] = useState(action.status);
  const [result, setResult] = useState<string | null>(action.result);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "apply" | "reject") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pax-console/actions/${action.id}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 410) setStatus("expired");
        else setError(j?.error || "That did not work. Try again.");
        return;
      }
      setStatus(j.status);
      setResult(j.result ?? null);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const pending = status === "pending";
  const tone = status === "applied" ? "text-emerald-400" : status === "failed" ? "text-red-400" : "text-stone-400";

  return (
    <div className="self-stretch max-w-[68ch] rounded-lg border border-amber-500/30 bg-stone-900 p-3 space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wider text-amber-300">Proposed change</p>
      <p className="text-[12px] text-stone-500">What will be sent. This is what runs, whatever the description below says:</p>
      <pre className="overflow-x-auto rounded-lg bg-stone-950 border border-stone-800 p-2 text-[12px] text-stone-200">{`${action.method} ${action.path}${queryString(action.query)}${bodyText(action.body) ? `\n${bodyText(action.body)}` : ""}`}</pre>
      <p className="text-[12px] text-stone-500">The model describes it as: <span className="text-stone-300">{action.summary}</span></p>
      {pending ? (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => decide("apply")} disabled={busy}
            className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[13px] font-medium disabled:opacity-50 inline-flex items-center gap-2">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}Apply
          </button>
          <button type="button" onClick={() => decide("reject")} disabled={busy}
            className="h-8 px-3 rounded-lg text-[13px] text-stone-300 hover:bg-stone-800 disabled:opacity-50 inline-flex items-center gap-2">
            <X size={13} />Reject
          </button>
        </div>
      ) : (
        <p className={`text-[12px] ${tone}`}>{PAST[status] ?? status}{result ? `: ${result.slice(0, 300)}` : ""}</p>
      )}
      {error && <p className="text-[12px] text-red-400">{error}</p>}
    </div>
  );
}
