import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 * Uptime check — verifies the app is running and the DB is reachable.
 * Returns 200 when healthy, 503 when the DB is down.
 * Safe to call from external monitors (no auth required).
 */
export async function GET() {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return Response.json({
      status: "ok",
      db: "connected",
      latencyMs: Date.now() - start,
      ts: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("[health] DB ping failed:", e?.message);
    return Response.json({
      status: "error",
      db: "disconnected",
      error: e?.message ?? "unknown",
      ts: new Date().toISOString(),
    }, { status: 503 });
  }
}
