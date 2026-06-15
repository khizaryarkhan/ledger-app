"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";

type Source = "qbo" | "xero";

export function SyncButton() {
  const [source, setSource]   = useState<Source | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice]   = useState<{ ok: boolean; msg: string } | null>(null);

  // Detect which integration is connected once on mount
  useEffect(() => {
    Promise.all([
      fetch("/api/qbo/sync").then(r => r.json()).catch(() => ({ connected: false })),
      fetch("/api/xero/sync").then(r => r.json()).catch(() => ({ connected: false })),
    ]).then(([qbo, xero]) => {
      if (qbo.connected) setSource("qbo");
      else if (xero.connected) setSource("xero");
    });
  }, []);

  const label = source === "qbo" ? "QuickBooks" : "Xero";

  const trigger = useCallback(async () => {
    if (!source || syncing) return;
    setSyncing(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/${source}/sync`, { method: "POST" });
      if (res.ok) {
        setNotice({ ok: true, msg: `${label} synced` });
      } else {
        const d = await res.json().catch(() => ({}));
        setNotice({ ok: false, msg: d.error ?? "Sync failed" });
      }
    } catch {
      setNotice({ ok: false, msg: "Sync failed" });
    } finally {
      setSyncing(false);
      setTimeout(() => setNotice(null), 4000);
    }
  }, [source, syncing, label]);

  if (!source) return null;

  return (
    <div className="flex items-center gap-2">
      {notice && (
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${notice.ok ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"}`}>
          {notice.msg}
        </span>
      )}
      <button
        onClick={trigger}
        disabled={syncing}
        title={`Sync ${label} now`}
        className="flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-medium rounded-lg border border-stone-700 text-stone-400 hover:text-emerald-300 hover:border-emerald-700/50 hover:bg-emerald-500/5 transition-colors disabled:opacity-50"
      >
        <RefreshCw size={11} className={syncing ? "animate-spin text-emerald-400" : ""} />
        {syncing ? "Syncing…" : `Sync ${label}`}
      </button>
    </div>
  );
}
