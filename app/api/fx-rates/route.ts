import { requireOrg, ok, bad } from "@/lib/api";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getRates } from "@/lib/fx-rates";

/**
 * GET /api/fx-rates
 * Returns live FX rates based on the org's home currency.
 * Response: { base: "EUR", rates: { USD: 1.08, GBP: 0.86, ... }, asOf: ISO }
 */
export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [org] = await db
    .select({ currency: organisations.currency })
    .from(organisations)
    .where(eq(organisations.id, orgId!))
    .limit(1);

  const base = org?.currency ?? "EUR";

  try {
    const ratesMap = await getRates(base);
    const rates: Record<string, number> = {};
    ratesMap.forEach((v, k) => { rates[k] = v; });
    return ok({ base, rates, asOf: new Date().toISOString() });
  } catch (e: any) {
    return bad(`FX fetch failed: ${e.message}`, 500);
  }
}
