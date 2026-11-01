/**
 * PATCH  /api/resources/designations/:id  → edit (organisation admin only)
 * DELETE /api/resources/designations/:id  → delete (refused while any person holds it)
 */

import { db } from "@/db";
import { resourceDesignations, resources } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { isAdminRole } from "@/lib/resources/access";
import { designationNameKey, parseDesignation } from "@/lib/resources/people-rules";
import { and, eq } from "drizzle-orm";

async function guard() {
  const r = await requireOrg();
  if (r.error) return { error: r.error } as const;
  const { error: modErr } = await requireModule(r.orgId!, "resources");
  if (modErr) return { error: modErr } as const;
  if (!isAdminRole(r.role)) return { error: bad("Only organisation admins can manage designations", 403) } as const;
  return { error: null, orgId: r.orgId! } as const;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guard();
  if (g.error) return g.error;
  const orgId = g.orgId;

  const [existing] = await db.select().from(resourceDesignations)
    .where(and(eq(resourceDesignations.id, params.id), eq(resourceDesignations.orgId, orgId))).limit(1);
  if (!existing) return bad("Designation not found", 404);

  const parsed = parseDesignation(await req.json().catch(() => ({})), true);
  if (!parsed.ok) return bad(parsed.error);
  const v = parsed.value;

  if (v.name !== undefined) {
    const others = await db.select({ id: resourceDesignations.id, name: resourceDesignations.name }).from(resourceDesignations)
      .where(eq(resourceDesignations.orgId, orgId));
    const key = designationNameKey(v.name);
    if (others.some(o => o.id !== existing.id && designationNameKey(o.name) === key)) {
      return bad(`A designation named "${v.name}" already exists`, 409);
    }
  }

  const [row] = await db.update(resourceDesignations).set(v)
    .where(and(eq(resourceDesignations.id, params.id), eq(resourceDesignations.orgId, orgId))).returning();
  return ok(row);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const g = await guard();
  if (g.error) return g.error;
  const orgId = g.orgId;

  const [existing] = await db.select({ id: resourceDesignations.id }).from(resourceDesignations)
    .where(and(eq(resourceDesignations.id, params.id), eq(resourceDesignations.orgId, orgId))).limit(1);
  if (!existing) return bad("Designation not found", 404);

  const [held] = await db.select({ id: resources.id }).from(resources)
    .where(and(eq(resources.orgId, orgId), eq(resources.designationId, params.id))).limit(1);
  if (held) return bad("People still hold this designation — reassign them, or deactivate the designation instead", 409);

  await db.delete(resourceDesignations)
    .where(and(eq(resourceDesignations.id, params.id), eq(resourceDesignations.orgId, orgId)));
  return ok({ ok: true });
}
