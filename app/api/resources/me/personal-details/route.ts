/**
 * GET /api/resources/me/personal-details → your own personal, emergency and bank details
 * PUT /api/resources/me/personal-details → change them
 *
 * Self-service for any login linked to a person (including employee logins,
 * hence allowEmployee). The person is found from the SESSION, never from the
 * request, so nobody can name someone else's record here. Employment fields
 * (number, job title, type, dates) stay with the administrator
 * (SELF_LOCKED_FIELDS). Secrets are masked exactly as on the admin route, so
 * even the person themselves never reads a full account number back.
 */
import { db } from "@/db";
import { resources } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { loadDetails, updateDetails } from "@/lib/resources/personal-details-server";
import { and, eq } from "drizzle-orm";

async function me() {
  const ctx = await requireOrg({ allowEmployee: true });
  if (ctx.error) return { error: ctx.error } as const;
  const { error: modErr } = await requireModule(ctx.orgId!, "resources");
  if (modErr) return { error: modErr } as const;
  const userId = (ctx.session!.user as any).id as string;
  const [person] = await db.select({ id: resources.id, name: resources.name, status: resources.status })
    .from(resources)
    .where(and(eq(resources.orgId, ctx.orgId!), eq(resources.userId, userId), eq(resources.type, "person")))
    .limit(1);
  if (!person) return { error: bad("Your login is not linked to a person record yet. Ask your administrator.", 404) } as const;
  if (person.status !== "active") return { error: bad("Your person record is inactive.", 403) } as const;
  return { ctx, person, userId } as const;
}

export async function GET() {
  const m = await me();
  if ("error" in m) return m.error;
  return ok({ ...(await loadDetails(m.ctx.orgId!, m.person.id)), name: m.person.name });
}

export async function PUT(req: Request) {
  const m = await me();
  if ("error" in m) return m.error;
  const r = await updateDetails(m.ctx.orgId!, m.person.id, await req.json().catch(() => ({})),
    { id: m.userId, name: (m.ctx.session!.user as any).name ?? null }, { self: true, personName: m.person.name });
  if ("error" in r) return bad(r.error, r.status);
  return ok(r.result);
}
