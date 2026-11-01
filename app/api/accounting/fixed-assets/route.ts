/**
 * GET  /api/accounting/fixed-assets?asAt=YYYY-MM-DD  -> register with accumulated / NBV
 * POST /api/accounting/fixed-assets                  -> create an asset (admins)
 */

import { db } from "@/db";
import { fixedAssets } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, desc } from "drizzle-orm";
import { accumulatedAsAt, netBookValueAsAt, termsError, scheduleFor } from "@/lib/accounting/fixed-assets";
import { accountsError, postedPeriodsByAsset, toCents, toTerms } from "@/lib/accounting/fixed-assets-server";
import { localToday } from "@/lib/format";

const ADMIN = ["company_admin", "super_admin"];
const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const asAtParam = new URL(req.url).searchParams.get("asAt");
  if (asAtParam && !isYmd(asAtParam)) return bad("asAt must be YYYY-MM-DD");
  const asAt = asAtParam || localToday();
  const [rows, posted] = await Promise.all([
    db.select().from(fixedAssets).where(eq(fixedAssets.orgId, orgId!)).orderBy(desc(fixedAssets.createdAt)),
    postedPeriodsByAsset(orgId!),
  ]);
  return ok({
    asAt,
    assets: rows.map(a => {
      const t = toTerms(a);
      const p = posted.get(a.id);
      return {
        ...a,
        accumulated: accumulatedAsAt(t, asAt),
        netBookValue: netBookValueAsAt(t, asAt),
        postedPeriods: p?.size ?? 0,
        schedulePeriods: scheduleFor(t).length,
      };
    }),
  });
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!ADMIN.includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));

  const name = str(b?.name);
  if (!name || name.length > 160) return bad("Name is required (160 characters max).");
  const terms = {
    purchaseDate: str(b?.purchaseDate),
    cost: Number(b?.cost),
    salvageValue: b?.salvageValue === "" || b?.salvageValue == null ? 0 : Number(b.salvageValue),
    usefulLifeMonths: Number(b?.usefulLifeMonths),
  };
  const te = termsError(terms);
  if (te) return bad(te);
  const ids = { asset: str(b?.assetAccountId), accum: str(b?.accumDepAccountId), expense: str(b?.depreciationExpenseAccountId) };
  if (!ids.asset || !ids.accum || !ids.expense) return bad("Choose the asset, accumulated depreciation and expense accounts.");
  const ae = await accountsError(orgId!, ids);
  if (ae) return bad(ae);

  const [row] = await db.insert(fixedAssets).values({
    orgId: orgId!,
    code: str(b?.code).slice(0, 32) || null,
    name,
    purchaseDate: terms.purchaseDate,
    cost: toCents(terms.cost),
    salvageValue: toCents(terms.salvageValue),
    usefulLifeMonths: terms.usefulLifeMonths,
    assetAccountId: ids.asset,
    accumDepAccountId: ids.accum,
    depreciationExpenseAccountId: ids.expense,
    notes: str(b?.notes) || null,
  }).returning();
  return ok(row);
}
