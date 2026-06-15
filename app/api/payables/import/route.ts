/**
 * POST /api/payables/import
 * CSV import for AP entities. Currently supports: suppliers, purchase-orders.
 */
import { db } from "@/db";
import { apSuppliers } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and } from "drizzle-orm";

export const maxDuration = 120;

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const type = formData.get("type") as string | null;

  if (!file) return bad("No file provided");
  if (!type) return bad("No import type specified");

  const text = await file.text();
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return bad("File is empty or has no data rows");

  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""));
  const rows = lines.slice(1);

  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  if (type === "suppliers") {
    for (let i = 0; i < rows.length; i++) {
      const cols = rows[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = cols[idx] ?? ""; });

      const name = row.name || row.supplier_name;
      if (!name) { errors.push(`Row ${i + 2}: Name is required`); continue; }

      try {
        const existing = await db
          .select({ id: apSuppliers.id })
          .from(apSuppliers)
          .where(and(eq(apSuppliers.orgId, orgId!), eq(apSuppliers.name, name)))
          .limit(1);

        const values = {
          orgId: orgId!,
          name,
          displayName: row.display_name || null,
          code: row.code || null,
          email: row.email || null,
          phone: row.phone || null,
          country: row.country || null,
          currency: row.currency || "EUR",
          paymentTerms: parseInt(row.payment_terms) || 30,
          taxNumber: row.tax_number || null,
          status: row.status || "Active",
          source: "manual" as const,
          updatedAt: new Date(),
        };

        if (existing.length > 0) {
          await db.update(apSuppliers).set(values).where(eq(apSuppliers.id, existing[0].id));
          updated++;
        } else {
          await db.insert(apSuppliers).values({ ...values, createdAt: new Date() });
          created++;
        }
      } catch (e: any) {
        errors.push(`Row ${i + 2}: ${e.message}`);
      }
    }
  } else {
    return bad(`Import type "${type}" is not supported yet`, 400);
  }

  return ok({ created, updated, errors });
}
