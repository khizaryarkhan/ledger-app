/**
 * Employee login for a person resource (organisation admin only).
 *
 * POST   /api/resources/:id/login  {email, password}  → give this person a login
 * PATCH  /api/resources/:id/login  {password}         → reset its password
 * DELETE /api/resources/:id/login                     → remove the login
 *
 * The login has role "employee": requireOrg() confines it to
 * /api/resources/me/**, so it can only fill its owner's own timesheet.
 * The password is never logged or returned. neon-http has no transactions, so
 * everything is validated before the first write.
 */

import { db } from "@/db";
import { resources, users, userOrganisations } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { requireModule } from "@/lib/modules-server";
import { isAdminRole } from "@/lib/resources/access";
import { normaliseLoginEmail, passwordError } from "@/lib/resources/people-rules";
import { and, eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

const EMPLOYEE_ROLE = "employee";
const BCRYPT_COST = 12;

async function guard(params: { id: string }) {
  const r = await requireOrg();
  if (r.error) return { error: r.error } as const;
  const { error: modErr } = await requireModule(r.orgId!, "resources");
  if (modErr) return { error: modErr } as const;
  if (!isAdminRole(r.role)) return { error: bad("Only organisation admins can manage logins", 403) } as const;

  const [person] = await db.select({ id: resources.id, type: resources.type, name: resources.name, userId: resources.userId })
    .from(resources).where(and(eq(resources.id, params.id), eq(resources.orgId, r.orgId!))).limit(1);
  if (!person) return { error: bad("Person not found", 404) } as const;
  if (person.type !== "person") return { error: bad("Only people can have a login") } as const;

  const actor = r.session!.user as any;
  return { error: null, orgId: r.orgId!, person, actorId: actor.id as string, actorName: (actor.name ?? null) as string | null } as const;
}

/**
 * The linked user, only if it really is a login THIS org made and owns: an
 * employee-role member of this org and of no other. An account that also
 * belongs to another organisation (say it was later made an admin there) is
 * not this org's to reset or remove.
 */
async function employeeLoginOf(userId: string, orgId: string) {
  const memberships = await db.select({ orgId: userOrganisations.orgId, role: userOrganisations.role })
    .from(userOrganisations).where(eq(userOrganisations.userId, userId));
  if (memberships.length !== 1) return null;
  const only = memberships[0];
  if (only.orgId !== orgId || only.role !== EMPLOYEE_ROLE) return null;
  const [u] = await db.select({ id: users.id, email: users.email, orgId: users.orgId, role: users.role })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.orgId !== orgId || u.role !== EMPLOYEE_ROLE) return null;
  return u;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await guard(params);
  if (g.error) return g.error;
  const { orgId, person } = g;

  const body = await req.json().catch(() => ({}));
  const email = normaliseLoginEmail(body?.email);
  if (!email) return bad("A valid email address is required");
  const pwErr = passwordError(body?.password);
  if (pwErr) return bad(pwErr);
  if (person.userId) return bad("This person already has a login", 409);

  const [taken] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (taken) return bad(`An account with the email "${email}" already exists`, 409);

  const passwordHash = await bcrypt.hash(body.password as string, BCRYPT_COST);
  const [created] = await db.insert(users).values({
    orgId, name: person.name, email, passwordHash, role: EMPLOYEE_ROLE, status: "Active",
  }).returning({ id: users.id });

  try {
    await db.insert(userOrganisations).values({ userId: created.id, orgId, role: EMPLOYEE_ROLE });
    await db.update(resources).set({ userId: created.id, updatedAt: new Date() })
      .where(and(eq(resources.id, person.id), eq(resources.orgId, orgId)));
  } catch {
    // Roll back the half-made login: the membership goes with the user (cascade).
    await db.delete(users).where(eq(users.id, created.id)).catch(() => {});
    return bad("Could not create the login", 500);
  }

  await logEvent({
    orgId, eventType: "user_role_changed", actorId: g.actorId, actorName: g.actorName,
    meta: { action: "employee_login_created", resourceId: person.id, targetUserId: created.id, targetEmail: email, newRole: EMPLOYEE_ROLE },
  });
  return ok({ ok: true, loginEmail: email });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guard(params);
  if (g.error) return g.error;
  const { orgId, person } = g;

  const body = await req.json().catch(() => ({}));
  const pwErr = passwordError(body?.password);
  if (pwErr) return bad(pwErr);
  if (!person.userId) return bad("This person has no login to reset", 409);

  const login = await employeeLoginOf(person.userId, orgId);
  if (!login) return bad("The linked account is not an employee login and cannot be changed here", 403);

  const passwordHash = await bcrypt.hash(body.password as string, BCRYPT_COST);
  // Never touch `status`: resetting a password must not re-enable an account
  // someone deactivated.
  await db.update(users).set({ passwordHash }).where(eq(users.id, login.id));

  await logEvent({
    orgId, eventType: "user_password_reset", actorId: g.actorId, actorName: g.actorName,
    meta: { resourceId: person.id, targetUserId: login.id, targetEmail: login.email, method: "admin_manual" },
  });
  return ok({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const g = await guard(params);
  if (g.error) return g.error;
  const { orgId, person } = g;

  if (!person.userId) return bad("This person has no login", 409);
  const login = await employeeLoginOf(person.userId, orgId);
  if (!login) return bad("The linked account is not an employee login and cannot be removed here", 403);

  await db.update(resources).set({ userId: null, updatedAt: new Date() })
    .where(and(eq(resources.id, person.id), eq(resources.orgId, orgId)));
  await db.delete(userOrganisations)
    .where(and(eq(userOrganisations.userId, login.id), eq(userOrganisations.orgId, orgId)));

  const [stillMember] = await db.select({ id: userOrganisations.id }).from(userOrganisations)
    .where(eq(userOrganisations.userId, login.id)).limit(1);
  if (!stillMember) await db.update(users).set({ status: "Inactive" }).where(eq(users.id, login.id));

  await logEvent({
    orgId, eventType: "user_deactivated", actorId: g.actorId, actorName: g.actorName,
    meta: { action: "employee_login_removed", resourceId: person.id, targetUserId: login.id, targetEmail: login.email },
  });
  return ok({ ok: true });
}
