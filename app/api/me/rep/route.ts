/**
 * GET /api/me/rep
 *
 * Returns the rep record linked to the currently logged-in user via
 * users.repId — the authoritative FK that admins set in the Admin Portal.
 *
 * The users table already has repId → reps.id. This is the correct lookup:
 * no email/name guessing, just a direct FK join.
 *
 * Returns null if the user has no repId assigned (admin or member not yet
 * linked to a rep record). The rep portal treats null as "see all" for admins.
 *
 * Rep portal visibility by tier:
 *   - tier "rep"  → their own projects/customers only
 *   - tier "rd"   → their own + all direct reports (rep.managerId === rd.id)
 *   - tier "ed"   → all (no filter)
 *   - null        → admin / unlinked — no filter applied
 */

import { db } from "@/db";
import { users, reps } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq } from "drizzle-orm";

export async function GET() {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const userId: string | undefined = (session?.user as any)?.id;
  if (!userId) return ok(null);

  // Look up this user's repId from the users table — assigned by admin
  const [user] = await db
    .select({ repId: users.repId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.repId) return ok(null);

  // Fetch the full rep record (scoped to this org for safety)
  const [rep] = await db
    .select()
    .from(reps)
    .where(and(eq(reps.id, user.repId), eq(reps.orgId, orgId!)))
    .limit(1);

  return ok(rep ?? null);
}
