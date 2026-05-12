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
  if (!asOf) return bad("asOf=YYYY-MM-DD required");

  const today = new Date().toISOString().slice(0, 10);
  const isHistorical = asOf < today;

  // Decide which engine to use.
  const useQbo =
    source === "qbo" ||
    (source !== "local" && isHistorical);

  try {
    if (useQbo) {
      try {
        const result = await fetchQboAging(orgId!, asOf);
        return ok({ ...result, source: "qbo" as const });
      } catch (qboErr: any) {
        // QBO call failed (token expired, no connection, rate limit, etc.).
        // Fall back to the local engine so the report still loads.
        const result = await computeArAging(orgId!, asOf, includeClosed);
        return ok({
          ...result,
          source: "local" as const,
          qboFallbackReason: qboErr?.message || String(qboErr),
        });
      }
    }
    const result = await computeArAging(orgId!, asOf, includeClosed);
    return ok({ ...result, source: "local" as const });
  } catch (e: any) {
    return bad(e?.message || "Failed to compute AR aging", 500);
  }
}
