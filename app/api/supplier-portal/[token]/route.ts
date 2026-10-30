/**
 * Supplier portal — public, token-authenticated, scoped to ONE purchase order.
 *
 * GET              → the order as the supplier sees it (no other org data)
 * GET  ?pdf=1      → a PDF copy of that order
 * POST { kind: "confirm" | "revise" | "decline", message?, lines? }
 *
 * A revision is only STORED here; the order does not change until a user at the
 * buyer accepts it. Rate-limited per IP and per token because it is unauthenticated.
 */
import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { LedgerValidationError } from "@/lib/ledger";
import { checkSupplierToken, supplierPortalView, submitSupplierResponse } from "@/lib/accounting/po-supplier-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const rl = await rateLimit(`supplier-portal-get:${clientIp(req)}`, 60, 60);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const wantsPdf = new URL(req.url).searchParams.get("pdf") === "1";
  if (wantsPdf) {
    // A PDF costs a headless-Chromium render, so it gets its own, much stricter limit.
    const pr = await rateLimit(`supplier-portal-pdf:${clientIp(req)}`, 5, 60);
    if (!pr.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    const v = await checkSupplierToken(params.token);
    if ("reason" in v) return NextResponse.json({ error: v.reason }, { status: 410 });
    const { renderTradeDocumentPdf } = await import("@/lib/pdf/document-pdf");
    const pdf = await renderTradeDocumentPdf(v.token.orgId, v.token.documentId);
    if (!pdf) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="purchase-order.pdf"' } });
  }
  const view = await supplierPortalView(params.token);
  if ("reason" in view) return NextResponse.json({ error: view.reason }, { status: view.reason === "not_found" ? 404 : 410 });
  return NextResponse.json(view);
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const rl = await rateLimit(`supplier-portal-post:${clientIp(req)}:${params.token.slice(0, 12)}`, 20, 600);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  // And per token alone, so rotating IPs cannot flood one order (each answer emails the buyer).
  const tl = await rateLimit(`supplier-portal-post-token:${params.token.slice(0, 24)}`, 10, 600);
  if (!tl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  const lines = Array.isArray(b.lines)
    ? b.lines.slice(0, 500).filter((l: any) => typeof l?.lineId === "string").map((l: any) => ({
        lineId: l.lineId,
        qty: l.qty === null || l.qty === undefined || l.qty === "" ? null : Number(l.qty),
        date: typeof l.date === "string" ? l.date : null,
      }))
    : [];
  try {
    return NextResponse.json(await submitSupplierResponse(params.token, { kind: b.kind, message: typeof b.message === "string" ? b.message : null, lines }));
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[supplier-portal] submit failed:", e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
