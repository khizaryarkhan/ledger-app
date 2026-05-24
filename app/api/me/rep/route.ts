/**
 * GET /api/me/rep
 *
 * Returns the rep record that corresponds to the currently logged-in user,
 * matched by the session user's email address (case-insensitive).
 *
 * Returns null if the user is not registered as a rep (e.g. company admin).
 * The rep portal uses this to scope its entity list to the correct rep tier:
 *   - tier "rep"  → their own projects/customers only
 *   - tier "rd"   → their direct reports' + their own
 *   - tier "ed"   → all (no filter)
 *   - null        → admin user — no filter applied
 */

import { db } from "@/db";
import { reps } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq, or, sql } from "drizzle-orm";

export async function GET() {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const email: string | undefined = (session?.user as any)?.email?.trim().toLowerCase();
  const name:  string | undefined = (session?.user as any)?.name?.trim().toLowerCase();

  if (!email && !name) return ok(null);

  // 1st priority: match by email (most reliable)
  // 2nd priority: match by name as fallback (for rep records where email is not set)
  // Both are case-insensitive. Returns the first match found.
  const conditions = [];
  if (email) conditions.push(sql`lower(${reps.email}) = ${email}`);
  if (name)  conditions.push(sql`lower(${reps.name})  = ${name}`);

  const [rep] = await db
    .select()
    .from(reps)
    .where(and(eq(reps.orgId, orgId!), or(...conditions)))
    .limit(1);

  return ok(rep ?? null);
}
