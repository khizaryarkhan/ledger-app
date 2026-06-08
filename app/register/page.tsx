"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

// ── Step indicator ──────────────────────────────────────────────────────────
function Steps({ current }: { current: number }) {
  const steps = ["Your details", "Verify email", "Payment"];
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((label, i) => {
        const idx  = i + 1;
        const done = idx < current;
        const active = idx === current;
        return (
          <div key={i} className="flex items-center gap-2">
            <div className={`flex items-center gap-2 ${active ? "opacity-100" : done ? "opacity-80" : "opacity-40"}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                ${done || active ? "bg-emerald-500 text-white" : "bg-stone-700 text-stone-400"}`}>
                {done ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : idx}
              </div>
              <span className={`text-xs font-medium ${active ? "text-white" : done ? "text-stone-300" : "text-stone-500"}`}>{label}</span>
            </div>
            {i < steps.length - 1 && <div className="w-8 h-px bg-stone-700" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Details form ────────────────────────────────────────────────────
function StepDetails({ onNext }: { onNext: (data: { pendingId: string; email: string; name: string }) => void }) {
  const [form, setForm]       = useState({ companyName: "", adminName: "", adminEmail: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res  = await fetch("/api/register/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went wrong"); return; }
      onNext({ pendingId: data.pendingId, email: form.adminEmail, name: form.adminName });
    } finally { setLoading(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs font-medium text-stone-400 block mb-1.5">Company name</label>
        <input required value={form.companyName} onChange={e => set("companyName", e.target.value)}
          placeholder="Acme Accounting Ltd"
          className="w-full h-10 px-3 text-sm rounded-lg border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors" />
      </div>
      <div>
        <label className="text-xs font-medium text-stone-400 block mb-1.5">Your full name</label>
        <input required value={form.adminName} onChange={e => set("adminName", e.target.value)}
          placeholder="Jane Smith"
          className="w-full h-10 px-3 text-sm rounded-lg border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors" />
      </div>
      <div>
        <label className="text-xs font-medium text-stone-400 block mb-1.5">Work email</label>
        <input required type="email" value={form.adminEmail} onChange={e => set("adminEmail", e.target.value)}
          placeholder="jane@acme.com"
          className="w-full h-10 px-3 text-sm rounded-lg border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors" />
      </div>
      {error && <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5">{error}</div>}
      <button type="submit" disabled={loading}
        className="w-full h-10 bg-emerald-500 hover:bg-emerald-400 disabled:bg-stone-700 disabled:text-stone-500 text-white text-sm font-semibold rounded-lg transition-colors">
        {loading ? "Sending code…" : "Continue →"}
      </button>
      <p className="text-center text-xs text-stone-600">
        Already have an account?{" "}
        <Link href="/login" className="text-stone-400 hover:text-white transition-colors">Sign in</Link>
      </p>
    </form>
  );
}

// ── Step 2: OTP verification ────────────────────────────────────────────────
function StepOtp({ pendingId, email, name, onNext, onBack }: {
  pendingId: string; email: string; name: string;
  onNext: () => void; onBack: () => void;
}) {
  const [otp, setOtp]             = useState(["", "", "", "", "", ""]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [resending, setResending] = useState(false);
  const [resent, setResent]       = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const code = otp.join("");

  const handleChange = (i: number, v: string) => {
    const digit = v.replace(/\D/, "").slice(-1);
    const next  = [...otp]; next[i] = digit; setOtp(next);
    if (digit && i < 5) inputs.current[i + 1]?.focus();
  };

  const handleKey = (i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) { setOtp(pasted.split("")); inputs.current[5]?.focus(); }
  };

  const verify = async (codeToVerify = code) => {
    if (codeToVerify.length < 6) return;
    setError(""); setLoading(true);
    try {
      const res  = await fetch("/api/register/verify-otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingId, otp: codeToVerify }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Invalid code"); return; }
      onNext();
    } finally { setLoading(false); }
  };

  useEffect(() => { if (code.length === 6) verify(code); }, [code]);

  const resend = async () => {
    setResending(true);
    try {
      await fetch("/api/register/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: "resend", adminName: name, adminEmail: email }),
      });
      setOtp(["", "", "", "", "", ""]); inputs.current[0]?.focus();
      setResent(true); setTimeout(() => setResent(false), 5000);
    } finally { setResending(false); }
  };

  return (
    <div className="space-y-5">
      <div className="text-center">
        <p className="text-sm text-stone-400">We sent a 6-digit code to</p>
        <p className="text-sm font-medium text-white mt-0.5">{email}</p>
      </div>
      <div className="flex gap-2 justify-center" onPaste={handlePaste}>
        {otp.map((digit, i) => (
          <input key={i} ref={el => { inputs.current[i] = el; }}
            type="text" inputMode="numeric" maxLength={1} value={digit}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKey(i, e)}
            className="w-11 h-12 text-center text-xl font-bold rounded-lg border border-stone-700 bg-stone-800/60 text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors" />
        ))}
      </div>
      {error && <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5 text-center">{error}</div>}
      <button onClick={() => verify(code)} disabled={loading || code.length < 6}
        className="w-full h-10 bg-emerald-500 hover:bg-emerald-400 disabled:bg-stone-700 disabled:text-stone-500 text-white text-sm font-semibold rounded-lg transition-colors">
        {loading ? "Verifying…" : "Verify email →"}
      </button>
      <div className="flex items-center justify-between text-xs text-stone-500">
        <button onClick={onBack} className="hover:text-stone-300 transition-colors">← Change email</button>
        <button onClick={resend} disabled={resending} className="hover:text-stone-300 transition-colors">
          {resent ? "✓ Code resent" : resending ? "Resending…" : "Resend code"}
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Payment ─────────────────────────────────────────────────────────
function StepPayment({ pendingId, onBack, cancelled }: { pendingId: string; onBack: () => void; cancelled: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  const goToStripe = async () => {
    setError(""); setLoading(true);
    try {
      const res  = await fetch("/api/register/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to start checkout"); return; }
      window.location.href = data.checkoutUrl;
    } catch { setError("Something went wrong. Please try again."); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-5">
      {cancelled && (
        <div className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-center">
          Payment was cancelled. You can try again below.
        </div>
      )}
      <div className="bg-stone-800/60 rounded-xl border border-stone-700 p-4 space-y-3">
        <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">What's included</div>
        {[
          "Unlimited collections board",
          "QuickBooks Online sync",
          "Automated email workflows",
          "Customer payment portal",
          "Team management",
          "Priority support",
        ].map(item => (
          <div key={item} className="flex items-center gap-2 text-sm text-stone-300">
            <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {item}
          </div>
        ))}
      </div>
      {error && <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5">{error}</div>}
      <button onClick={goToStripe} disabled={loading}
        className="w-full h-11 bg-emerald-500 hover:bg-emerald-400 disabled:bg-stone-700 disabled:text-stone-500 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2">
        {loading ? "Redirecting to Stripe…" : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            Continue to secure payment
          </>
        )}
      </button>
      <p className="text-center text-xs text-stone-600 flex items-center justify-center gap-1">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        Secured by Stripe. We never store your card details.
      </p>
      <div className="text-center">
        <button onClick={onBack} className="text-xs text-stone-500 hover:text-stone-300 transition-colors">← Back</button>
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
function RegisterPageInner() {
  const params    = useSearchParams();
  const cancelled = params.get("cancelled") === "1";
  const stepParam = params.get("step");

  const [step, setStep]           = useState(stepParam === "payment" ? 3 : 1);
  const [pendingId, setPendingId] = useState(params.get("pid") || "");
  const [email, setEmail]         = useState("");
  const [name, setName]           = useState("");

  const titles: Record<number, { title: string; sub: string }> = {
    1: { title: "Start your free trial",   sub: "Set up your account in minutes"  },
    2: { title: "Verify your email",       sub: "Enter the code we sent you"       },
    3: { title: "Almost there",            sub: "Complete your subscription below" },
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-950 p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-emerald-500/5 rounded-full blur-3xl" />
      </div>
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500 mb-4">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white tracking-tight">{titles[step].title}</h1>
          <p className="text-sm text-stone-500 mt-1">{titles[step].sub}</p>
        </div>

        <Steps current={step} />

        <div className="bg-stone-900 rounded-xl border border-stone-800 p-6">
          {step === 1 && (
            <StepDetails onNext={({ pendingId: pid, email: em, name: nm }) => {
              setPendingId(pid); setEmail(em); setName(nm); setStep(2);
            }} />
          )}
          {step === 2 && (
            <StepOtp pendingId={pendingId} email={email} name={name}
              onNext={() => setStep(3)} onBack={() => setStep(1)} />
          )}
          {step === 3 && (
            <StepPayment pendingId={pendingId} onBack={() => setStep(2)} cancelled={cancelled} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-stone-950">
        <div className="text-stone-400 text-sm">Loading…</div>
      </div>
    }>
      <RegisterPageInner />
    </Suspense>
  );
}
