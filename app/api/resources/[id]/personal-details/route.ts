/**
 * GET /api/resources/:id/personal-details  → a person's personal, employment,
 *                                             emergency and bank details
 * PUT /api/resources/:id/personal-details  → change them (keys left out stay as they are)
 *
 * Organisation admins only: this is HR and payroll data, and a manager's
 * people scope is about timesheets, not about reading a bank account.
 * Secret fields are encrypted at rest and only ever returned masked
 * (lib/resources/personal-details.ts). The path segment "personal-details" is
 * on the AI-connection deny-list, so no model ever reads it.
 */
import { db } from "@/db";
import { resources } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { isAdminRole } from "@/lib/resources/access";
import { loadDetails, updateDetails } from "@/lib/resources/personal-details-server";
import { and, eq } from "drizzle-orm";

async function guard(id: string) {
  const ctx = await requireOrg();
  if (ctx.error) return { error: ctx.error } as const;
  const { error: modErr } = await requireModule(ctx.orgId!, "resources");
  if (modErr) return { error: modErr } as const;
  if (!isAdminRole(ctx.role)) return { error: bad("Only organisation admins can see or change personal details", 403) } as const;
  const [person] = await db.select({ id: resources.id, type: resources.type, name: resources.name })
    .from(resources).where(and(eq(resources.id, id), eq(resources.orgId, ctx.orgId!))).limit(1);
  if (!person) return { error: bad("Person not found", 404) } as const;
  if (person.type !== "person") return { error: bad("Personal details belong to people, not equipment") } as const;
  return { ctx, person } as const;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if ("error" in g) return g.error;
  return ok(await loadDetails(g.ctx.orgId!, params.id));
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if ("error" in g) return g.error;
  const user = g.ctx.session!.user as any;
  const r = await updateDetails(g.ctx.orgId!, params.id, await req.json().catch(() => ({})),
    { id: user.id, name: user.name ?? null }, { self: false, personName: g.person.name });
  if ("error" in r) return bad(r.error, r.status);
  return ok(r.result);
}
