/**
 * Live FX rate utility.
 *
 * Rates are fetched from frankfurter.app (free, no API key, ECB data)
 * and cached in the fx_rates table. Cache is considered fresh for 4 hours.
 *
 * Usage:
 *   const rates = await getRates("EUR");   // Map<"USD" | "GBP" | ..., number>
 *   const usdInEur = 1000 * (rates.get("USD") ?? 1);
 *
 * The map always contains base → 1.0 so callers can safely look up any
 * currency without special-casing same-currency invoices.
 */

import { db } from "@/db";
import { fxRates } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const FRANKFURTER  = "https://api.frankfurter.app/latest";

export async function getRates(base: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  map.set(base, 1); // same-currency is always 1.0

  try {
    // Check cache freshness
    const cached = await db
      .select()
      .from(fxRates)
      .where(eq(fxRates.base, base));

    const freshEnough =
      cached.length > 0 &&
      Date.now() - new Date(cached[0].updatedAt).getTime() < CACHE_TTL_MS;

    if (freshEnough) {
      cached.forEach((r) => map.set(r.quote, r.rate));
      return map;
    }

    // Fetch fresh rates
    await refreshRates(base);

    const fresh = await db.select().from(fxRates).where(eq(fxRates.base, base));
    fresh.forEach((r) => map.set(r.quote, r.rate));
  } catch (e) {
    console.warn("fx-rates: falling back to 1.0 rates –", (e as Error).message);
  }

  return map;
}

export async function refreshRates(base: string): Promise<void> {
  const res = await fetch(`${FRANKFURTER}?from=${base}`, {
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`frankfurter returned ${res.status}`);
  const data = await res.json();
  const rates: Record<string, number> = data.rates ?? {};

  // Upsert each rate
  for (const [quote, rate] of Object.entries(rates)) {
    await db
      .insert(fxRates)
      .values({ base, quote, rate: rate as number, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [fxRates.base, fxRates.quote],
        set: { rate: rate as number, updatedAt: new Date() },
      });
  }
}
