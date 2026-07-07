/**
 * PATCH  /api/accounting/[entity]/[id] — edit a NATIVE record (synced records
 *        are read-only; their source of truth is QBO/Xero).
 *        Any record (native or synced) can have its status toggled
 *        Active/Inactive — deactivating only affects our app.
 */

import { db } from "@/db";
import { apAccounts, apItems, apTaxRates } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const Patch = z.object({
  name:              z.string().min(1).max(255).optional(),
  type:              z.string().max(64).optional(),
  subtype:           z.string().max(64).nullable().optional(),
  code:              z.string().max(64).nullable().optional(),
  description:       z.string().max(4000).nullable().optional(),
  itemType:          z.string().max(32).optional(),
  rate:              z.number().min(0).max(100).optional(),
  taxType:           z.string().max(64).nullable().optional(),
  unitPrice:         z.number().nullable().optional(),
  unitCost:          z.number().nullable().optional(),
  incomeAccountId:   z.string().max(64).nullable().optional(),
  expenseAccountId:  z.string().max(64).nullable().optional(),
  taxRateId:         z.string().max(64).nullable().optional(),
  status:            z.enum(["Active", "Inactive"]).optional(),
});

function tableFor(entity: string) {
  if (entity === "accounts")  return apAccounts;
  if (entity === "items")     return apItems;
  if (entity === "tax-rates") return apTaxRates;
  return null;
}

export async function PATCH(req: Request, { params }: { params: { entity: string; id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const table = tableFor(params.entity) as any;
  if (!table) return bad("Unknown entity", 404);

  const [row] = await db.select().from(table)
    .where(and(eq(table.id, params.id), eq(table.orgId, orgId!))).limit(1);
  if (!row) return bad("Not found", 404);

  let d: z.infer<typeof Patch>;
  try { d = Patch.parse(await req.json()); }
  catch (e: any) { return bad(e?.issues?.[0]?.message ?? "Invalid request"); }

  // Synced records: only the status toggle is allowed locally.
  const isNative = row.source === "native";
  const keys = Object.keys(d).filter(k => (d as any)[k] !== undefined);
  if (!isNative && keys.some(k => k !== "status")) {
    return bad(`This record is synced from ${String(row.source).toUpperCase()} — edit it there, or only change its status here.`, 403);
  }

  const updated: any[] = await db.update(table)
    .set({ ...d, updatedAt: new Date() })
    .where(and(eq(table.id, params.id), eq(table.orgId, orgId!)))
    .returning() as any;
  return ok(updated[0]);
}
