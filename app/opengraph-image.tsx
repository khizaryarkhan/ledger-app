import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt =
  "Prime Accountax — AR Management & Collections Software for QuickBooks Online & Xero";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Branded Open Graph / Twitter / AI link-preview image.
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background:
            "radial-gradient(1200px 600px at 20% 0%, #0b3b2e 0%, #0c0a09 55%)",
          color: "#fafaf9",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 40 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "#10b981",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 44,
              fontWeight: 700,
              color: "#fff",
            }}
          >
            P
          </div>
          <div style={{ fontSize: 34, fontWeight: 600 }}>Prime Accountax</div>
        </div>
        <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1 }}>
          Stop chasing invoices.
        </div>
        <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.1, color: "#34d399", letterSpacing: -1 }}>
          Start collecting.
        </div>
        <div style={{ fontSize: 30, color: "#a8a29e", marginTop: 32, maxWidth: 900 }}>
          AR management &amp; automated collections for QuickBooks Online &amp; Xero.
        </div>
      </div>
    ),
    { ...size }
  );
}
