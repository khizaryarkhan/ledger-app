"use client";

import { useEffect, useState } from "react";
import { Card, Button } from "@/components/ui";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";

/**
 * Two-factor authentication enrolment for super admins. Self-gates via the
 * status endpoint (renders nothing for ineligible accounts). Opt-in: nothing
 * here affects login until the user completes enrolment.
 */
export function MfaCard() {
  const [loading, setLoading] = useState(true);
  const [eligible, setEligible] = useState(false);
  const [enabled, setEnabled] = useState(false);

  // enrolment state
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disarmCode, setDisarmCode] = useState("");
  const [disarming, setDisarming] = useState(false);

  const refresh = async () => {
    try {
      const r = await fetch("/api/auth/mfa/status");
      if (r.ok) {
        const d = await r.json();
        setEligible(!!d.eligible);
        setEnabled(!!d.enabled);
      }
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  if (loading) return null;
  if (!eligible) return null; // only super admins see this

  const beginSetup = async () => {
    setErr(""); setBusy(true); setRecoveryCodes(null);
    try {
      const r = await fetch("/api/auth/mfa/setup", { method: "POST" });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || "Failed to start setup"); return; }
      setSetup({ qrDataUrl: d.qrDataUrl, secret: d.secret });
    } finally { setBusy(false); }
  };

  const confirmEnable = async () => {
    setErr(""); setBusy(true);
    try {
      const r = await fetch("/api/auth/mfa/enable", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || "Invalid code"); return; }
      setRecoveryCodes(d.recoveryCodes || []);
      setSetup(null); setCode(""); setEnabled(true);
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setErr(""); setDisarming(true);
    try {
      const r = await fetch("/api/auth/mfa/disable", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: disarmCode }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || "Invalid code"); return; }
      setEnabled(false); setDisarmCode("");
    } finally { setDisarming(false); }
  };

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        {enabled
          ? <ShieldCheck size={16} className="text-emerald-400" />
          : <ShieldAlert size={16} className="text-amber-400" />}
        <h3 className="text-sm font-semibold text-stone-100">Two-Factor Authentication</h3>
      </div>
      <p className="text-xs text-stone-500 mb-4">
        Protects your super-admin account with a time-based code from an authenticator app.
      </p>

      {/* One-time recovery codes after enabling */}
      {recoveryCodes && (
        <div className="mb-4 rounded-lg border border-emerald-800 bg-emerald-950/40 p-3">
          <div className="text-xs font-semibold text-emerald-300 mb-2">
            Save these recovery codes now — they won’t be shown again.
          </div>
          <div className="grid grid-cols-2 gap-1 font-mono text-[13px] text-stone-200">
            {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <button
            onClick={() => navigator.clipboard?.writeText(recoveryCodes.join("\n"))}
            className="mt-2 text-[11px] text-emerald-400 hover:text-emerald-300">
            Copy all
          </button>
        </div>
      )}

      {err && <div className="mb-3 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">{err}</div>}

      {enabled ? (
        <div className="space-y-2">
          <div className="text-xs text-emerald-400 font-medium">Enabled</div>
          <div className="flex items-center gap-2">
            <input value={disarmCode} onChange={(e) => setDisarmCode(e.target.value)}
              placeholder="Code to disable"
              className="h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
            <Button variant="ghost" onClick={disable} disabled={disarming || !disarmCode}>
              {disarming ? <Loader2 size={14} className="animate-spin" /> : "Disable"}
            </Button>
          </div>
        </div>
      ) : setup ? (
        <div className="space-y-3">
          <p className="text-xs text-stone-400">
            Scan with Google Authenticator, Authy, or 1Password — or enter the key manually.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qrDataUrl} alt="MFA QR code" width={180} height={180}
            className="rounded-lg bg-white p-2" />
          <div className="text-[11px] text-stone-500">
            Manual key: <span className="font-mono text-stone-300 break-all">{setup.secret}</span>
          </div>
          <div className="flex items-center gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value)}
              inputMode="numeric" placeholder="6-digit code"
              className="h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
            <Button onClick={confirmEnable} disabled={busy || code.length < 6}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : "Verify & enable"}
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={beginSetup} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : "Enable 2FA"}
        </Button>
      )}
    </Card>
  );
}
