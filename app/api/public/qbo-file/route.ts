// GET /api/public/qbo-file?t=<signed link> — streams one QuickBooks PDF.
//
// The link is minted by POST /api/qbo/api when an admin's AI connection asks for
// `<entity>/<id>/pdf` (lib/qbo/file-link.ts). It is public because it is opened in
// a browser, not by the AI client, but it is not open: the signature names one
// org and one QuickBooks PDF path, it expires in 10 minutes, and the person it
// was minted for must STILL be an active admin of that org when it is used — so
// removing someone's access also kills any link they were handed.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { userOrganisations, users } from "@/db/schema";
import { getOrgQboToken } from "@/lib/qbo-token";
import { logEvent } from "@/lib/audit";
import { verifyFileLink } from "@/lib/qbo/file-link";
import { DEFAULT_MINOR_VERSION } from "@/lib/qbo/passthrough";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const QBO_API = process.env.QBO_ENV === "sandbox"
  ? "https://sandbox-quickbooks.api.intuit.com/v3/company"
  : "https://quickbooks.api.intuit.com/v3/company";
const ADMIN_ROLES = new Set(["company_admin", "super_admin"]);

const deny = (msg: string, status: number) =>
  new NextResponse(msg, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(req: NextRequest) {
  const claims = verifyFileLink(req.nextUrl.searchParams.get("t"));
  if (!claims) return deny("This download link is invalid or has expired (links last 10 minutes). Ask your AI assistant for a new one.", 403);

  const [member] = await db.select({ role: userOrganisations.role, status: users.status })
    .from(userOrganisations).innerJoin(users, eq(users.id, userOrganisations.userId))
    .where(and(eq(userOrganisations.userId, claims.userId), eq(userOrganisations.orgId, claims.orgId))).limit(1);
  if (!member || !ADMIN_ROLES.has(member.role) || String(member.status).toLowerCase() !== "active") {
    return deny("The person this link was made for no longer has admin access to this organisation.", 403);
  }

  const token = await getOrgQboToken(claims.orgId).catch(() => null);
  if (!token) return deny("QuickBooks is not connected for this organisation, or its authorisation has expired.", 409);

  const url = `${QBO_API}/${token.realmId}/${claims.path}?minorversion=${DEFAULT_MINOR_VERSION}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/pdf" },
    signal: AbortSignal.timeout(45_000),
  }).catch(() => null);
  if (!res || !res.ok) return deny(`QuickBooks did not return the PDF (status ${res?.status ?? "no response"}).`, 502);

  const pdf = Buffer.from(await res.arrayBuffer());
  await logEvent({
    orgId: claims.orgId, eventType: "qbo_api_call", actorId: claims.userId, actorName: null,
    meta: { via: "mcp", kind: "read", method: "GET", path: claims.path, file: "pdf", downloaded: true, bytes: pdf.length, status: res.status, intuitTid: res.headers.get("intuit_tid") },
  }).catch((e) => console.error("[qbo-file] audit row not written:", e));

  const [entity, id] = claims.path.split("/");
  return new NextResponse(pdf, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${entity}-${id}.pdf"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
