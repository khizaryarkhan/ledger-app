/**
 * AR Aging — Summary + Detail in one call.
 *
 * GET /api/reports/ar-aging?asOf=YYYY-MM-DD[&source=qbo|local]
 *
 * For historical dates (asOf < today) we call QBO's own AgedReceivableDetail
 * report directly — it's the authoritative source. QBO walks the GL and
 * reconstructs AR state at the report date, naturally handling CM
 * applications, JE write-offs, refunds, and voids without needing to
 * reconstruct from our event store.
 *
 * For today's date we use the local engine which has access to extra
 * collection context (collection_stage, owner, flags) the QBO report
 * doesn't carry.
 *
 * `source` override:
 *   - source=qbo    → force QBO report regardless of date
 *   - source=local  → force local event-sourced engine
 *   - (default)     → QBO for historical, local for today
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { computeArAging } from "@/lib/ar-aging";
import { fetchQboAging } from "@/lib/qbo-aging-report";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const asOf = url.searchParams.get("asOf");
  const includeClosed = url.searchParams.get("includeClosed") === "true";
  const source = url.searchParams.get("source"); // "qbo" | "local" | null
  // QBO UI defaults: it hides customers whose net is at or below zero (credit
  // balances are listed in a separate Credit section, not in the aging total).
  // Match that by default; clients can opt back in via ?includeCredits=true.
  const includeCredits = url.searchParams.get("includeCredits") === "true";
  const agingMethodParam = url.searchParams.get("agingMethod"); // "Current" | "Report_Date"
  if (!asOf) return bad("asOf=YYYY-MM-DD required");

  const today = new Date().toISOString().slice(0, 10);
  const isHistorical = asOf < today;

  // Decide which engine to use.
  const useQbo =
    source === "qbo" ||
    (source !== "local" && isHistorical);

  const applyDisplayFilters = (result: any) => {
    if (includeCredits) return result;
    // QBO UI default: drop summary rows whose total is <= 0. The customer
    // still has those open transactions in QBO, but the UI shows them as
    // credits, not as part of the AR aging buckets.
    const filteredSummary = (result.summary || []).filter((s: any) => s.total > 0.005);
    const hiddenIds = new Set(
      (result.summary || []).filter((s: any) => s.total <= 0.005).map((s: any) => s.customerId),
    );
    const filteredDetail = (result.detail || []).filter((d: any) => !hiddenIds.has(d.customerId));
    // Recompute grand totals from the visible rows so the headline ties to
    // the displayed table. Anything hidden contributed <= 0 to the total.
    const grandTotals: any = { Current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "91+": 0, total: 0 };
    for (const d of filteredDetail) {
      grandTotals[d.bucket] += d.openBalance;
      grandTotals.total    += d.openBalance;
    }
    return { ...result, summary: filteredSummary, detail: filteredDetail, grandTotals };
  };

  try {
    if (useQbo) {
      try {
        const result = await fetchQboAging(orgId!, asOf, {
          agingMethod: agingMethodParam === "Current" ? "Current" : "Report_Date",
        });
        return ok({ ...applyDisplayFilters(result), source: "qbo" as const });
      } catch (qboErr: any) {
        // QBO call failed (token expired, no connection, rate limit, etc.).
        // Fall back to the local engine so the report still loads.
        const result = await computeArAging(orgId!, asOf, includeClosed);
        return ok({
          ...applyDisplayFilters(result),
          source: "local" as const,
          qboFallbackReason: qboErr?.message || String(qboErr),
        });
      }
    }
    const result = await computeArAging(orgId!, asOf, includeClosed);
    return ok({ ...applyDisplayFilters(result), source: "local" as const });
  } catch (e: any) {
    return bad(e?.message || "Failed to compute AR aging", 500);
  }
}
