"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SsccLabelSheet, type LabelData } from "@/components/sscc-label-sheet";

export default function PrintShipmentLabelsPage() {
  const id = String(useParams().id || "");
  const [data, setData] = useState<LabelData | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/inventory/shipping/${id}/labels`)
      .then(async r => { const d = await r.json().catch(() => null); if (r.ok && d?.labels) setData(d); else setErr(d?.error || "Could not load these labels"); })
      .catch(() => setErr("Could not load these labels"));
  }, [id]);

  if (err) return <div style={{ padding: 40, fontFamily: "system-ui" }}>{err}</div>;
  if (!data) return <div style={{ padding: 40, fontFamily: "system-ui", color: "#6b7280" }}>Loading…</div>;
  return <SsccLabelSheet data={data} />;
}
