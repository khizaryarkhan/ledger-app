/**
 * POST /api/inventory/customer-part-numbers/bulk   { customerId, text, commit? }
 *
 * A customer's whole part-number list in one go (pasted from a spreadsheet): "our item or SKU, their part number
 * [, level]" per line. Without `commit` nothing is saved and every line says what it would match or why it cannot;
 * with `commit: true` the lines that matched are saved and each reports its own outcome. Admins only, like the
 * single-number route. Rules: lib/inventory/part-numbers-bulk(-server).ts.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { parsePartList } from "@/lib/inventory/part-numbers-bulk";
import { matchBulkRows, saveBulkRows } from "@/lib/inventory/part-numbers-bulk-server";

const isAdmin = (role?: string | null) => ["company_admin", "super_admin"].includes(role ?? "");

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!isAdmin(role)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const customerId = String(b?.customerId ?? "");
  if (!customerId) return bad("Choose a customer.");
  if (typeof b?.text !== "string" || !b.text.trim()) return bad("Paste the list first.");
  if (b.text.length > 400_000) return bad("That list is too large. Split it.");
  const { rows, problems } = parsePartList(b.text);
  let results = await matchBulkRows(orgId!, rows);
  if (b?.commit === true) results = await saveBulkRows(orgId!, customerId, results);
  return ok({
    committed: b?.commit === true, problems, results,
    summary: { lines: rows.length, matched: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length + problems.length },
  });
}
