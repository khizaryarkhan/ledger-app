"use client";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("App error:", error); }, [error]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 p-8">
      <div className="max-w-lg w-full bg-white rounded-xl ring-1 ring-rose-200 p-6">
        <h2 className="text-base font-semibold text-rose-700 mb-2">Application error</h2>
        <p className="text-sm font-mono text-stone-700 bg-stone-50 rounded p-3 mb-4 whitespace-pre-wrap break-all">
          {error.message}
          {error.stack && "\n\n" + error.stack.slice(0, 500)}
        </p>
        <button onClick={reset} className="px-4 py-2 bg-stone-900 text-white text-sm rounded-md hover:bg-stone-800">Try again</button>
      </div>
    </div>
  );
}
