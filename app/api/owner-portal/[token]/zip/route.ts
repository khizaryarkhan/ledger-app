/**
 * GET /api/owner-portal/[token]/zip?ids=<uuid,uuid,...>&name=<zip-label>
 *
 * Bundles the requested invoice PDFs into one ZIP for the escalation owner —
 * used for "download all invoices of this project" in the owner portal.
 * Token-authenticated; every id must be inside the token's snapshot.
 */

import { validateOwnerPortalToken } from "@/lib/portal";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getOrgQboToken } from "@/lib/qbo-token";
import { getOrgXeroToken } from "@/lib/xero-token";
import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import JSZip from "jszip";

const QBO_API  = "https://quickbooks.api.intuit.com/v3/company";
const XERO_API = "https://api.xero.com/api.xro/2.0";

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const rl = await rateLimit(`owner-portal-zip:${clientIp(req)}`, 10, 60);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const v = await validateOwnerPortalToken(params.token);
  if (!v.ok) return NextResponse.json({ error: "Invalid or expired link" }, { status: 410 });
  const { row } = v as { ok: true; row: any };

  const url = new URL(req.url);
  const reqIds = (url.searchParams.get("ids") ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const label = (url.searchParams.get("name") ?? "invoices").replace(/[^\w\- ]+/g, "").slice(0, 60) || "invoices";
  if (reqIds.length === 0 || reqIds.length > 100) {
    return NextResponse.json({ error: "ids required (max 100)" }, { status: 400 });
  }

  // Every requested id must be in the token's snapshot.
  const allowed = new Set((row.invoiceIds as string[]) ?? []);
  if (reqIds.some(id => !allowed.has(id))) {
    return NextResponse.json({ error: "Invoice not covered by this link" }, { status: 403 });
  }

  const allRows = await db
    .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, qboId: invoices.qboId, xeroId: invoices.xeroId, collectionStage: invoices.collectionStage, escalatedToEmail: invoices.escalatedToEmail })
    .from(invoices)
    .where(and(eq(invoices.orgId, row.orgId), inArray(invoices.id, reqIds)));
  // Current-ownership check — only invoices still escalated to this owner.
  const ownerEmail = String(row.ownerEmail).toLowerCase();
  const rows = allRows.filter(r =>
    r.collectionStage === "Escalated" && String(r.escalatedToEmail ?? "").toLowerCase() === ownerEmail
  );
  if (rows.length === 0) return NextResponse.json({ error: "No invoices found" }, { status: 404 });

  const needsXero = rows.some(r => r.xeroId && !r.xeroId.startsWith("CN-"));
  const xeroToken = needsXero ? await getOrgXeroToken(row.orgId).catch(() => null) : null;
  const qboToken  = await getOrgQboToken(row.orgId).catch(() => null);

  async function fetchPdf(inv: (typeof rows)[0]): Promise<Buffer | null> {
    try {
      if (inv.xeroId && !inv.xeroId.startsWith("CN-") && xeroToken) {
        const res = await fetch(`${XERO_API}/Invoices/${inv.xeroId}`, {
          headers: { Authorization: `Bearer ${xeroToken.accessToken}`, "Xero-Tenant-Id": xeroToken.tenantId, Accept: "application/pdf" },
        });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength > 0) return buf;
        }
      }
      if (inv.qboId && !inv.qboId.startsWith("CM-") && qboToken) {
        const res = await fetch(`${QBO_API}/${qboToken.realmId}/invoice/${inv.qboId}/pdf?minorversion=65`, {
          headers: { Authorization: `Bearer ${qboToken.accessToken}`, Accept: "application/pdf" },
        });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength > 0) return buf;
        }
      }
    } catch { /* skip */ }
    return null;
  }

  const zip = new JSZip();
  let added = 0;
  for (let i = 0; i < rows.length; i += 5) {
    const chunk = rows.slice(i, i + 5);
    const bufs = await Promise.all(chunk.map(async r => ({ r, pdf: await fetchPdf(r) })));
    for (const { r, pdf } of bufs) {
      if (pdf) { zip.file(`Invoice-${r.invoiceNumber || r.id}.pdf`, pdf); added++; }
    }
  }
  if (added === 0) return NextResponse.json({ error: "No PDFs available from the accounting system" }, { status: 404 });

  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return new Response(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${label}-invoices.zip"`,
      "X-Included-Count": String(added),
    },
  });
}
