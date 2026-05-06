"use client";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html>
      <body style={{ fontFamily: "monospace", padding: "2rem", background: "#fafaf9" }}>
        <div style={{ maxWidth: 700, margin: "0 auto", background: "white", border: "1px solid #fee2e2", borderRadius: 8, padding: "1.5rem" }}>
          <h2 style={{ color: "#dc2626", marginTop: 0 }}>Crash details</h2>
          <pre style={{ background: "#f5f5f4", padding: "1rem", borderRadius: 4, overflowX: "auto", fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {error?.message || "Unknown error"}
            {"\n\n"}
            {error?.stack || "No stack trace"}
          </pre>
        </div>
      </body>
    </html>
  );
}
