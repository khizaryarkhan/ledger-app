/**
 * POST /api/batch/bulk-edit/search
 * Body: { entity, customerId?, from?, to?, status? }
 *
 * Returns the transactions matching the in-app filters so the user can pick
 * which ones to bulk-edit. Read-only — just a scoped QBO query.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboQueryAll } from "@/lib/batch/qbo-client";

export const runtime = "nodejs";
export const maxDuration = 60;

const esc = (s: string) => String(s).replace(/'/g, "\\'");
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body) return bad("Invalid JSON body");

  const entity = getEntity(String(body.entity || ""));
  if (!entity?.qboReadName) return bad("Unknown entity", 404);
  if (!entity.supports?.modify) return bad("This entity can't be bulk-edited", 400);

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const clauses: string[] = [];
  if (body.customerId && entity.group === "customer") clauses.push(`CustomerRef = '${esc(String(body.customerId))}'`);
  if (body.from && isDate(body.from)) clauses.push(`TxnDate >= '${body.from}'`);
  if (body.to && isDate(body.to)) clauses.push(`TxnDate <= '${body.to}'`);
  // NOT in the WHERE clause, deliberately — same class of bug as "expense"'s
  // PaymentType filter elsewhere in this file's sibling routes: QBO's query
  // API silently returns zero rows for `TxnStatus = 'Pending'` even against
  // a company that genuinely has Pending estimates (confirmed as the reported
  // "status filter doesn't work" symptom). Filtered client-side below instead.

  const where = clauses.join(" AND ");
  let records: any[];
  try {
    records = await qboQueryAll(token, entity.qboReadName, where);
    if (body.status && entity.id === "estimate") {
      records = records.filter((r: any) => r.TxnStatus === body.status);
    }
  } catch (e: any) {
    return bad(e?.message || "QuickBooks query failed", 502);
  }

  const rows = records.slice(0, 1000).map((r: any) => ({
    id: String(r.Id),
    docNumber: r.DocNumber ?? null,
    customer: r.CustomerRef?.name ?? null,
    txnDate: r.TxnDate ?? null,
    total: r.TotalAmt ?? null,
    className: r.ClassRef?.name ?? null,
    location: r.DepartmentRef?.name ?? null,
    linkedInvoices: Array.isArray(r.LinkedTxn) ? r.LinkedTxn.filter((l: any) => l?.TxnType === "Invoice").length : 0,
    status: r.TxnStatus ?? null,
  }));

  return ok({ rows, total: records.length, truncated: records.length > 1000 });
}
