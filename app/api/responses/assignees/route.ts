import { db } from "@/db";
import { users, userOrganisations } from "@/db/schema";
import { requireOrg } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * GET /api/responses/assignees
 * Returns the org's members ({id, name}) for the dispute reassignment dropdown.
 * Any authenticated org member can read this (names only).
 */
export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(userOrganisations)
    .leftJoin(users, eq(users.id, userOrganisations.userId))
    .where(eq(userOrganisations.orgId, orgId!));

  const seen = new Set<string>();
  const list = rows
    .filter(r => r.id && r.name && !seen.has(r.id) && seen.add(r.id))
    .map(r => ({ id: r.id as string, name: r.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ assignees: list });
}
