"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await signIn("credentials", { email, password, redirect: false });
      if (res?.error) {
        setError("Invalid email or password");
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch (e) {
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-md bg-stone-900 flex items-center justify-center">
              <span className="text-white text-xs font-bold tracking-tight">AR</span>
            </div>
            <div className="text-left">
              <div className="text-base font-semibold text-stone-900 tracking-tight leading-none">Ledger</div>
              <div className="text-[10px] text-stone-500 mt-0.5 tracking-wide">COLLECTIONS CRM</div>
            </div>
          </div>
          <h1 className="text-xl font-semibold text-stone-900 tracking-tight">Sign in to your account</h1>
          <p className="text-sm text-stone-500 mt-1">Welcome back</p>
        </div>

        <div className="bg-white rounded-lg ring-1 ring-stone-200 p-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-stone-700 block mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="w-full h-10 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white" />
            </div>
            <div>
              <label className="text-xs font-medium text-stone-700 block mb-1">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
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
          New here? <Link href="/register" className="text-stone-900 font-medium hover:underline">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
