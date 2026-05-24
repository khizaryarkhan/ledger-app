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
import { and, eq, sql } from "drizzle-orm";

export async function GET() {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const email: string | undefined = (session?.user as any)?.email;
  if (!email) return ok(null);

  // Case-insensitive match on email within this org
  const [rep] = await db
    .select()
    .from(reps)
    .where(
      and(
        eq(reps.orgId, orgId!),
        sql`lower(${reps.email}) = lower(${email})`,
      )
    )
    .limit(1);

  return ok(rep ?? null);
}
