"use client";

import { useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const email = (emailRef.current?.value ?? "").trim();
    const password = passwordRef.current?.value ?? "";
    try {
      const res = await signIn("credentials", { email, password, redirect: false });
      if (res?.error) {
        setError("Invalid email or password");
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-xl font-semibold text-stone-900 tracking-tight">Collection Manager</h1>
          <p className="text-sm text-stone-500 mt-1">Sign in to your account</p>
        </div>

        <div className="bg-white rounded-lg ring-1 ring-stone-200 p-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-stone-700 block mb-1">Email</label>
              <input ref={emailRef} type="email" required
                autoComplete="email"
                className="w-full h-10 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white" />
            </div>
            <div>
              <label className="text-xs font-medium text-stone-700 block mb-1">Password</label>
              <input ref={passwordRef} type="password" required
                autoComplete="current-password"
                className="w-full h-10 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white" />
            </div>
            {error && <div className="text-sm text-rose-600 bg-rose-50 ring-1 ring-rose-200 rounded-md p-2.5">{error}</div>}
            <button type="submit" disabled={loading}
              className="w-full h-10 bg-stone-900 text-white text-sm font-medium rounded-md hover:bg-stone-800 disabled:bg-stone-300">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-stone-500 mt-4">
          Contact your administrator to get access.
        </p>
      </div>
    </div>
  );
}
