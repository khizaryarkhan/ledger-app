"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type Status = "provisioning" | "done" | "already_done" | "error";

function SuccessPageInner() {
  const params    = useSearchParams();
  const sessionId = params.get("session_id");

  const [status, setStatus] = useState<Status>("provisioning");
  const [adminEmail, setAdminEmail] = useState("");
  const [errorMsg, setErrorMsg]     = useState("");

  useEffect(() => {
    if (!sessionId) { setStatus("error"); setErrorMsg("No session ID found."); return; }

    fetch("/api/register/complete", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ sessionId }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setAdminEmail(data.admin?.email || "");
          setStatus(data.alreadyProvisioned ? "already_done" : "done");
        } else {
          setErrorMsg(data.error || "Something went wrong.");
          setStatus("error");
        }
      })
      .catch(() => { setErrorMsg("Network error — please contact support."); setStatus("error"); });
  }, [sessionId]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-950 p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-emerald-500/5 rounded-full blur-3xl" />
      </div>
      <div className="relative w-full max-w-sm text-center">
        {/* Logo */}
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500 mb-6">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>

        <div className="bg-stone-900 rounded-xl border border-stone-800 p-8 space-y-5">

          {/* ── Provisioning spinner ── */}
          {status === "provisioning" && (
            <>
              <div className="w-14 h-14 rounded-full bg-stone-800 flex items-center justify-center mx-auto">
                <svg className="w-7 h-7 text-emerald-400 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-semibold text-white">Setting up your account…</h1>
                <p className="text-sm text-stone-400 mt-2">This takes just a moment. Please don't close this tab.</p>
              </div>
            </>
          )}

          {/* ── Success ── */}
          {(status === "done" || status === "already_done") && (
            <>
              <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
                <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-semibold text-white">
                  {status === "already_done" ? "Account already active!" : "Payment confirmed!"}
                </h1>
                <p className="text-sm text-stone-400 mt-2">Welcome to Prime Accountax. Your account is ready.</p>
              </div>

              {/* Steps */}
              <div className="text-left bg-stone-800/50 rounded-lg border border-stone-700 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Account created</p>
                    <p className="text-xs text-stone-500">Your organisation and admin account are ready</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 mt-0.5 animate-pulse">
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Check your email</p>
                    <p className="text-xs text-stone-500">
                      A password setup link was sent to{" "}
                      {adminEmail ? <span className="text-stone-300 font-medium">{adminEmail}</span> : "your inbox"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-stone-700 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-stone-400">3</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-stone-400">Set your password & sign in</p>
                    <p className="text-xs text-stone-600">Click the link in your email to set your password</p>
                  </div>
                </div>
              </div>

              <p className="text-xs text-stone-500">
                Didn't receive the email? Check your spam folder or{" "}
                <a href="mailto:support@primeaccountax.com" className="text-emerald-400 hover:text-emerald-300 transition-colors">
                  contact support
                </a>
              </p>

              <Link href="/login"
                className="block w-full h-10 bg-stone-800 hover:bg-stone-700 text-stone-300 text-sm font-medium rounded-lg transition-colors flex items-center justify-center">
                Go to sign in
              </Link>
            </>
          )}

          {/* ── Error ── */}
          {status === "error" && (
            <>
              <div className="w-14 h-14 rounded-full bg-rose-500/15 flex items-center justify-center mx-auto">
                <svg className="w-7 h-7 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-semibold text-white">Something went wrong</h1>
                <p className="text-sm text-stone-400 mt-2">{errorMsg}</p>
              </div>
              <div className="bg-amber-500/10 ring-1 ring-amber-500/20 rounded-lg p-3 text-xs text-amber-300 text-left">
                <p className="font-semibold mb-1">Your payment was successful.</p>
                <p>Please email <a href="mailto:support@primeaccountax.com" className="underline">support@primeaccountax.com</a> and we'll set up your account manually within the hour.</p>
              </div>
              <Link href="/login"
                className="block w-full h-10 bg-stone-800 hover:bg-stone-700 text-stone-300 text-sm font-medium rounded-lg transition-colors flex items-center justify-center">
                Go to sign in
              </Link>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

export default function RegisterSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-stone-950">
        <div className="text-stone-400 text-sm">Loading…</div>
      </div>
    }>
      <SuccessPageInner />
    </Suspense>
  );
}
