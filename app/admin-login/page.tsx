"use client";

import { useRef, useState, useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Eye, EyeOff, Loader2 } from "lucide-react";

export default function AdminLoginPage() {
  const router   = useRouter();
  const { data: session, status } = useSession();
  const emailRef    = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const mfaRef      = useRef<HTMLInputElement>(null);
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw,  setShowPw]  = useState(false);
  const [showMfa, setShowMfa] = useState(false);

  // Already signed in as admin — bounce to admin portal
  useEffect(() => {
    if (status !== "authenticated") return;
    const role = (session?.user as any)?.role;
    if (role === "super_admin" || role === "platform_admin") {
      router.replace("/admin");
    } else {
      setError("Your account does not have admin access.");
    }
  }, [status, session, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const email   = (emailRef.current?.value ?? "").trim();
    const password = passwordRef.current?.value ?? "";
    const mfaCode  = (mfaRef.current?.value ?? "").trim();
    try {
      const res = await signIn("credentials", { email, password, mfaCode, redirect: false });
      if (res?.error) {
        setError(showMfa
          ? "Invalid email, password, or authentication code"
          : "Invalid email or password");
      } else {
        // Let the session load — useEffect above handles the redirect
        router.refresh();
      }
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-950 p-4">
      {/* Subtle background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[350px] bg-indigo-500/6 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-[300px] h-[250px] bg-emerald-500/4 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo / brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-stone-900 border border-stone-800 mb-4 shadow-lg">
            <ShieldCheck size={22} className="text-emerald-400" />
          </div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Admin Portal</h1>
          <p className="text-sm text-stone-500 mt-1">Prime Accountax · Platform access only</p>
        </div>

        <div className="bg-stone-900 rounded-2xl border border-stone-800 p-6 shadow-2xl">
          <form onSubmit={onSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="text-xs font-medium text-stone-400 block mb-1.5">Email</label>
              <input
                ref={emailRef}
                type="email"
                required
                autoComplete="email"
                autoFocus
                placeholder="admin@primeaccountax.com"
                className="w-full h-10 px-3 text-sm rounded-lg border border-stone-700 bg-stone-800/60 text-white placeholder-stone-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors"
              />
            </div>

            {/* Password */}
            <div>
              <label className="text-xs font-medium text-stone-400 block mb-1.5">Password</label>
              <div className="relative">
                <input
                  ref={passwordRef}
                  type={showPw ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  className="w-full h-10 px-3 pr-10 text-sm rounded-lg border border-stone-700 bg-stone-800/60 text-white placeholder-stone-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300 transition-colors"
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* MFA */}
            {showMfa && (
              <div>
                <label className="text-xs font-medium text-stone-400 block mb-1.5">Authentication code</label>
                <input
                  ref={mfaRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code or recovery code"
                  className="w-full h-10 px-3 text-sm rounded-lg border border-stone-700 bg-stone-800/60 text-white placeholder-stone-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors font-mono tracking-widest"
                />
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2.5 leading-relaxed">
                {error}
              </div>
            )}

            {/* MFA toggle */}
            {!showMfa && !error && (
              <button
                type="button"
                onClick={() => setShowMfa(true)}
                className="text-xs text-stone-500 hover:text-stone-400 transition-colors"
              >
                Have a 2FA code?
              </button>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 disabled:text-stone-500 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 mt-2"
            >
              {loading
                ? <><Loader2 size={14} className="animate-spin" /> Signing in…</>
                : "Sign in to Admin Portal"
              }
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-stone-700 mt-6">
          This portal is restricted to Prime Accountax platform administrators.
        </p>
      </div>
    </div>
  );
}
