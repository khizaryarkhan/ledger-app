/**
 * Atomic fixed-window rate limiter backed by Postgres (no Redis in the stack).
 *
 * FAIL-OPEN by design: if the rate_limits table hasn't been migrated yet, or
 * any DB error occurs, the request is allowed. The limiter only ever ADDS
 * protection — it must never lock legitimate users out due to infra issues.
 *
 * Apply the migration in db/migration-rate-limits.sql to activate it.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

export interface RateResult {
  ok: boolean;
  /** Seconds until the window resets (only meaningful when ok === false). */
  retryAfter: number;
}

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateResult> {
  try {
    const res: any = await db.execute(sql`
      INSERT INTO rate_limits (key, count, expires_at)
      VALUES (${key}, 1, now() + make_interval(secs => ${windowSec}))
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limits.expires_at < now() THEN 1 ELSE rate_limits.count + 1 END,
        expires_at = CASE WHEN rate_limits.expires_at < now()
                          THEN now() + make_interval(secs => ${windowSec})
                          ELSE rate_limits.expires_at END
      RETURNING count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - now()))))::int AS retry_after
    `);
    const rows = Array.isArray(res) ? res : res?.rows ?? [];
    const row = rows[0];
    if (!row) return { ok: true, retryAfter: 0 };
    const count = Number(row.count);
    const retryAfter = Number(row.retry_after);
    return count <= limit ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter };
  } catch (e: any) {
    console.warn("rateLimit fail-open:", e?.message);
    return { ok: true, retryAfter: 0 };
  }
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}
