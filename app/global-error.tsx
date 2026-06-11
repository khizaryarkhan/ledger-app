"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Log to console + report to Sentry (no-op unless NEXT_PUBLIC_SENTRY_DSN is set).
  useEffect(() => {
    console.error("Global error:", error);
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#fafaf9", margin: 0, padding: "2rem", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ maxWidth: 420, width: "100%", background: "white", border: "1px solid #e7e5e4", borderRadius: 12, padding: "2rem", textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#fff1f2", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1rem" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <h2 style={{ color: "#1c1917", fontSize: 16, fontWeight: 600, margin: "0 0 0.5rem" }}>Something went wrong</h2>
          <p style={{ color: "#78716c", fontSize: 14, margin: "0 0 1.5rem", lineHeight: 1.5 }}>
            An unexpected error occurred. Please refresh the page — if the problem persists, contact support.
          </p>
          {error?.digest && (
            <p style={{ color: "#a8a29e", fontSize: 11, margin: "0 0 1rem" }}>Reference: {error.digest}</p>
          )}
          <button
            onClick={reset}
            style={{ background: "#1c1917", color: "white", border: "none", borderRadius: 8, padding: "0.5rem 1.25rem", fontSize: 14, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
