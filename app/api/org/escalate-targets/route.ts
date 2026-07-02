import { db } from "@/db";
import { users, userOrganisations } from "@/db/schema";
import { requireOrg } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * GET /api/org/escalate-targets
 * Returns {id, name, email}[] for all active org members — accessible to any
 * authenticated org user (not admin-only) so reps can open the escalation picker.
 */
export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(userOrganisations)
    .leftJoin(users, eq(users.id, userOrganisations.userId))
    .where(and(
      eq(userOrganisations.orgId, orgId!),
      eq(users.status, "Active"),
    ));

  const seen = new Set<string>();
  const targets = rows
    .filter(r => r.id && r.name && r.email && !seen.has(r.id) && seen.add(r.id))
    .map(r => ({ id: r.id as string, name: r.name as string, email: r.email as string }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ targets });
}
