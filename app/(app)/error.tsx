"use client";
import { useEffect } from "react";
import { AlertCircle } from "lucide-react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Log full details server-side / in browser console only — never shown to user
  useEffect(() => { console.error("App error:", error); }, [error]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 p-8">
      <div className="max-w-md w-full bg-white rounded-xl ring-1 ring-stone-200 p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center mx-auto mb-4">
          <AlertCircle size={24} className="text-rose-500" />
        </div>
        <h2 className="text-base font-semibold text-stone-900 mb-2">Something went wrong</h2>
        <p className="text-sm text-stone-500 mb-6">
          An unexpected error occurred. Please try again — if the problem persists, contact support.
        </p>
        {error.digest && (
          <p className="text-[11px] text-stone-400 mb-4">Reference: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="px-5 py-2 bg-stone-900 text-white text-sm rounded-lg hover:bg-stone-800 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
