/**
 * GET /api/owner-portal/[token]/pdf/[invoiceId]
 *
 * Streams the invoice PDF to the escalation owner — token-authenticated, no
 * login. Pulls live from Xero/QBO (same provider order as the customer
 * portal); the invoice must be in the token's snapshot.
 *
 * Backstop for digest emails where a PDF was missing or over the size budget.
 */

import { validateOwnerPortalToken } from "@/lib/portal";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getOrgQboToken } from "@/lib/qbo-token";
import { getOrgXeroToken } from "@/lib/xero-token";
import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const QBO_API  = "https://quickbooks.api.intuit.com/v3/company";
const XERO_API = "https://api.xero.com/api.xro/2.0";
const TIMEOUT  = 15_000;

export async function GET(req: Request, { params }: { params: { token: string; invoiceId: string } }) {
  const rl = await rateLimit(`owner-portal-pdf:${clientIp(req)}`, 30, 60);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const v = await validateOwnerPortalToken(params.token);
  if (!v.ok) return NextResponse.json({ error: "Invalid or expired link" }, { status: 410 });
  const { row } = v as { ok: true; row: any };

  const ids = (row.invoiceIds as string[]) ?? [];
  if (!ids.includes(params.invoiceId)) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const [inv] = await db.select().from(invoices)
    .where(and(eq(invoices.id, params.invoiceId), eq(invoices.orgId, row.orgId))).limit(1);
  if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const filename = `Invoice-${inv.invoiceNumber || inv.id}.pdf`;
  const headers  = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${filename}"`,
    "Cache-Control": "private, max-age=300",
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    // Xero first (same order as the customer portal endpoint)
    if (inv.xeroId && !inv.xeroId.startsWith("CN-")) {
      const xt = await getOrgXeroToken(row.orgId).catch(() => null);
      if (xt) {
        const res = await fetch(`${XERO_API}/Invoices/${inv.xeroId}`, {
          headers: { Authorization: `Bearer ${xt.accessToken}`, "Xero-Tenant-Id": xt.tenantId, Accept: "application/pdf" },
          signal: controller.signal,
        });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 0) { clearTimeout(timer); return new Response(buf, { headers }); }
        }
      }
    }

    // Then QBO
    if (inv.qboId && !inv.qboId.startsWith("CM-")) {
      const token = await getOrgQboToken(row.orgId).catch(() => null);
      if (token) {
        const res = await fetch(`${QBO_API}/${token.realmId}/invoice/${inv.qboId}/pdf?minorversion=65`, {
          headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/pdf" },
          signal: controller.signal,
        });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 0) { clearTimeout(timer); return new Response(buf, { headers }); }
        }
      }
    }

    clearTimeout(timer);
    return NextResponse.json({ error: "PDF unavailable from the accounting system" }, { status: 404 });
  } catch {
    clearTimeout(timer);
    return NextResponse.json({ error: "PDF unavailable" }, { status: 502 });
  }
}
