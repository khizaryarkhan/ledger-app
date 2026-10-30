"use client";

/**
 * Supplier portal — the page a supplier opens from the emailed purchase order.
 * Public and token-authenticated; shows ONE order. The supplier can confirm it,
 * propose a different quantity or delivery date per line, or say they cannot
 * supply it. A proposal changes nothing until the buyer accepts it.
 *
 * Inline styles, like app/portal/[token]/page.tsx: this page is read by people
 * outside the app, so it must not depend on the app's dark/light theme tokens.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { fmt, formatDate } from "@/lib/format";

type Line = {
  id: string; name: string; orderUom: string | null; unitsPerOrderUnit: number; baseUom: string | null;
  qty: number; rate: number; amount: number; date: string | null; closed: boolean;
  proposedQty: number | null; proposedDate: string | null;
};
type View = {
  expiresAt: string;
  org: { name: string; logoUrl: string | null };
  po: { docNumber: string | null; issueDate: string; currency: string | null; supplierName: string | null; total: number; confirmed: boolean; rejected: boolean };
  pending: { message: string | null; createdAt: string } | null;
  lastReply: { text: string; status: string } | null;
  lines: Line[];
};

const money = (n: number, ccy: string | null) => fmt.money(n, ccy ?? undefined);
const qtyText = (n: number) => String(Math.round(n * 1e5) / 1e5);

const C = { ink: "#1c1917", sub: "#57534e", line: "#e7e5e4", bg: "#f5f5f4", green: "#047857", amber: "#92400e", amberBg: "#fffbeb", amberLine: "#f59e0b", red: "#b91c1c" };
const page: React.CSSProperties = { minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "system-ui,-apple-system,'Segoe UI',sans-serif", padding: "32px 20px", fontSize: 14 };
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden" };
const input: React.CSSProperties = { boxSizing: "border-box", height: 34, border: "1px solid #a8a29e", borderRadius: 6, background: "#fff", padding: "0 10px", fontSize: 14, color: C.ink, width: "100%" };

export default function SupplierPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<View | null>(null);
  const [problem, setProblem] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [date, setDate] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<"confirm" | "revise" | "decline" | null>(null);

  useEffect(() => {
    fetch(`/api/supplier-portal/${token}`).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setProblem(d?.error === "not_found" ? "This link isn't valid." : "This link has expired. Please contact the buyer directly."); return; }
      const v = d as View;
      setView(v);
      setQty(Object.fromEntries(v.lines.map(l => [l.id, qtyText(l.proposedQty ?? l.qty)])));
      setDate(Object.fromEntries(v.lines.map(l => [l.id, l.proposedDate ?? l.date ?? ""])));
      setMessage(v.pending?.message ?? "");
    }).catch(() => setProblem("Something went wrong loading this order."));
  }, [token]);

  // An emptied box means "unchanged", never "zero" — zero must be typed on purpose.
  const qtyOf = (l: Line) => (qty[l.id] ?? "").trim() === "" ? l.qty : Number(qty[l.id]);
  const changed = useMemo(() => (view?.lines ?? []).filter(l => !l.closed &&
    (Math.abs(qtyOf(l) - l.qty) > 1e-6 || (date[l.id] ?? "") !== (l.date ?? ""))), [view, qty, date]); // eslint-disable-line react-hooks/exhaustive-deps
  const newTotal = useMemo(() => (view?.lines ?? []).reduce((s, l) => s + (qtyOf(l) || 0) * l.rate, 0), [view, qty]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(kind: "confirm" | "revise" | "decline") {
    if (kind === "decline" && !confirm("Tell the buyer you cannot supply this order?")) return;
    const zeroed = (view?.lines ?? []).filter(l => !l.closed && qtyOf(l) === 0 && l.qty > 0);
    if (kind === "revise" && zeroed.length && !confirm(`You've set ${zeroed.map(l => l.name).join(", ")} to 0 — that tells the buyer you can't supply ${zeroed.length === 1 ? "it" : "them"}. Send anyway?`)) return;
    setBusy(true); setErr("");
    const res = await fetch(`/api/supplier-portal/${token}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, message, lines: kind === "revise" ? view!.lines.map(l => ({ lineId: l.id, qty: qtyOf(l), date: date[l.id] || null })) : [] }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(d?.error || "Something went wrong. Please try again."); return; }
    setDone(d.kind);
  }

  if (problem) return <div style={{ ...page, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ maxWidth: 360, textAlign: "center", color: C.sub }}>{problem}</div></div>;
  if (!view) return <div style={{ ...page, display: "flex", alignItems: "center", justifyContent: "center", color: C.sub }}>Loading…</div>;

  const { po, org } = view;
  if (done) {
    const text = done === "confirm" ? "Thank you — the order is confirmed." : done === "decline" ? "Thank you — we've let the buyer know you can't supply this order." : "Thank you — your changes have been sent. Nothing on the order changes until the buyer accepts them; you'll hear back by email.";
    return <div style={{ ...page, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ ...card, maxWidth: 440, padding: 28, textAlign: "center" }}><div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{po.docNumber}</div><div style={{ color: C.sub, lineHeight: 1.6 }}>{text}</div></div></div>;
  }

  const closedNote = po.rejected ? "This order has been withdrawn by the buyer. Please contact them directly."
    : po.confirmed && !view.pending ? "You have confirmed this order. You can still propose a change below."
    : null;
  const th: React.CSSProperties = { textAlign: "left", fontSize: 12, color: C.sub, padding: "10px 14px", borderBottom: `1px solid ${C.line}`, background: "#fafaf9", fontWeight: 500 };
  const td: React.CSSProperties = { padding: "12px 14px", borderBottom: "1px solid #f0efed", verticalAlign: "top" };

  return (
    <div style={page}>
      <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: C.sub }}>Purchase order from</div>
            <h1 style={{ margin: "2px 0 0", fontSize: 24, fontWeight: 600 }}>{org.name}</h1>
          </div>
          <div style={{ textAlign: "right", fontSize: 13, color: C.sub, lineHeight: 1.6 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.ink }}>{po.docNumber}</div>
            <div>{formatDate(po.issueDate)} · for {po.supplierName}</div>
            <a href={`/api/supplier-portal/${token}?pdf=1`} target="_blank" rel="noopener noreferrer" style={{ color: C.green, fontWeight: 600 }}>Download PDF copy</a>
          </div>
        </div>

        {closedNote && <div style={{ ...card, padding: "12px 16px", color: C.sub }}>{closedNote}</div>}
        {view.pending && <div style={{ background: C.amberBg, border: `1px solid ${C.amberLine}`, borderRadius: 8, padding: "12px 16px", color: "#78350f", lineHeight: 1.5 }}>You've proposed changes. Nothing on the order changes until {org.name} accepts them. You'll get an email with their answer.</div>}
        {view.lastReply && !view.pending && <div style={{ ...card, padding: "12px 16px", lineHeight: 1.5 }}><b>Reply from {org.name}:</b> {view.lastReply.text}</div>}

        <div style={card}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead><tr>
                <th style={th}>Item</th><th style={{ ...th, textAlign: "right" }}>Ordered</th><th style={{ ...th, textAlign: "right" }}>Price</th>
                <th style={th}>Your quantity</th><th style={th}>Delivery date</th><th style={{ ...th, textAlign: "right" }}>Line total</th>
              </tr></thead>
              <tbody>
                {view.lines.map(l => {
                  const uom = l.orderUom || l.baseUom || "";
                  const q = qtyOf(l) || 0;
                  const diff = q - l.qty;
                  const dateChanged = (date[l.id] ?? "") !== (l.date ?? "");
                  const hot = !l.closed && (Math.abs(diff) > 1e-6 || dateChanged);
                  return (
                    <tr key={l.id} style={{ background: hot ? "#fffdf5" : undefined }}>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{l.name}</div>
                        <div style={{ fontSize: 12, color: C.sub, marginTop: 3 }}>{uom}{l.unitsPerOrderUnit > 1 && l.baseUom ? ` of ${qtyText(l.unitsPerOrderUnit)} ${l.baseUom}` : ""}</div>
                      </td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        <div style={{ fontWeight: 600 }}>{qtyText(l.qty)} {uom}</div>
                        {l.unitsPerOrderUnit > 1 && l.baseUom && <div style={{ fontSize: 12, color: C.sub, marginTop: 3 }}>{qtyText(l.qty * l.unitsPerOrderUnit)} {l.baseUom}</div>}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(l.rate, po.currency)}</td>
                      <td style={{ ...td, width: 170 }}>
                        <input type="number" min="0" step="any" disabled={l.closed || po.rejected} value={qty[l.id] ?? ""} onChange={e => setQty(m => ({ ...m, [l.id]: e.target.value }))}
                          style={{ ...input, borderColor: hot && Math.abs(diff) > 1e-6 ? "#d97706" : "#a8a29e", borderWidth: hot && Math.abs(diff) > 1e-6 ? 2 : 1 }} aria-label={`Quantity of ${l.name}`} />
                        {Math.abs(diff) > 1e-6 && <div style={{ fontSize: 12, color: C.amber, marginTop: 4 }}>{qtyText(Math.abs(diff))} {diff < 0 ? "fewer" : "more"} than ordered</div>}
                      </td>
                      <td style={{ ...td, width: 160 }}>
                        <input type="date" disabled={l.closed || po.rejected} value={date[l.id] ?? ""} onChange={e => setDate(m => ({ ...m, [l.id]: e.target.value }))}
                          style={{ ...input, borderColor: dateChanged ? "#d97706" : "#a8a29e", borderWidth: dateChanged ? 2 : 1 }} aria-label={`Delivery date for ${l.name}`} />
                        {dateChanged && l.date && <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>Was {formatDate(l.date)}</div>}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        <div style={{ fontWeight: 600 }}>{money(q * l.rate, po.currency)}</div>
                        {Math.abs(diff) > 1e-6 && <div style={{ fontSize: 12, color: C.sub, marginTop: 3 }}>was {money(l.amount, po.currency)}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: 14, background: "#fafaf9", borderTop: `1px solid ${C.line}` }}>
            <span style={{ fontSize: 13, color: C.sub }}>Order total (before tax)</span>
            <span style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{money(newTotal, po.currency)}</span>
          </div>
        </div>

        {!po.rejected && (
          <>
            <div>
              <label htmlFor="msg" style={{ fontSize: 13, color: C.sub, display: "block", marginBottom: 6 }}>Message to {org.name} (optional)</label>
              <textarea id="msg" value={message} onChange={e => setMessage(e.target.value)} maxLength={2000} rows={3} style={{ ...input, height: 76, padding: "10px 12px", fontFamily: "inherit" }} />
            </div>
            {err && <div style={{ color: C.red }}>{err}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button disabled={busy || changed.length === 0} onClick={() => submit("revise")}
                style={{ height: 42, border: 0, borderRadius: 8, background: changed.length ? C.green : "#a8a29e", color: "#fff", fontSize: 15, fontWeight: 600, padding: "0 22px", cursor: changed.length ? "pointer" : "not-allowed" }}>
                Send my changes{changed.length ? ` (${changed.length})` : ""}
              </button>
              <button disabled={busy || (po.confirmed && !view.pending && changed.length === 0)} onClick={() => submit("confirm")}
                style={{ height: 42, border: "1px solid #a8a29e", borderRadius: 8, background: "#fff", color: C.ink, fontSize: 15, padding: "0 20px", cursor: "pointer" }}>
                {po.confirmed ? "Confirmed as ordered" : "Confirm as ordered"}
              </button>
              <button disabled={busy} onClick={() => submit("decline")}
                style={{ marginLeft: "auto", border: 0, background: "transparent", color: C.red, fontSize: 14, textDecoration: "underline", cursor: "pointer", padding: "0 8px" }}>
                We can't supply this order
              </button>
            </div>
          </>
        )}
        <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.6 }}>
          This private link is for {po.docNumber} only and expires on {formatDate(view.expiresAt.slice(0, 10))}. If you didn't expect this, contact {org.name} directly.
        </div>
      </div>
    </div>
  );
}
