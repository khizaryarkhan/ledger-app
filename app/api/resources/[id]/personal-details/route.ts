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
import { personDetails, resources } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { isAdminRole } from "@/lib/resources/access";
import { logEvent } from "@/lib/audit";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import {
  PLAIN_FIELDS, SECRET_FIELDS, maskSecret, parseDetailsPatch, datesOutOfOrder,
} from "@/lib/resources/personal-details";
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

function present(row: { details: Record<string, string>; secrets: Record<string, string>; updatedAt: Date } | undefined) {
  const details: Record<string, string> = {};
  for (const f of PLAIN_FIELDS) if (row?.details?.[f]) details[f] = row.details[f];
  const secrets: Record<string, ReturnType<typeof maskSecret>> = {};
  for (const f of SECRET_FIELDS) secrets[f] = maskSecret(decryptSecret(row?.secrets?.[f] ?? null));
  return { details, secrets, updatedAt: row?.updatedAt ?? null };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if ("error" in g) return g.error;
  const [row] = await db.select().from(personDetails)
    .where(and(eq(personDetails.resourceId, params.id), eq(personDetails.orgId, g.ctx.orgId!))).limit(1);
  return ok(present(row));
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if ("error" in g) return g.error;
  const { ctx } = g;

  // UTC today + 1 day, so someone west of Greenwich entering today's date is never refused.
  const tomorrowUtc = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const parsed = parseDetailsPatch(await req.json().catch(() => ({})), tomorrowUtc);
  if ("error" in parsed) return bad(parsed.error);
  const patch = parsed.patch;

  const [existing] = await db.select().from(personDetails)
    .where(and(eq(personDetails.resourceId, params.id), eq(personDetails.orgId, ctx.orgId!))).limit(1);

  const details: Record<string, string> = { ...(existing?.details ?? {}) };
  const secrets: Record<string, string> = { ...(existing?.secrets ?? {}) };
  const changed: string[] = [];
  for (const f of PLAIN_FIELDS) {
    if (!(f in patch)) continue;
    const v = patch[f];
    if ((details[f] ?? null) === (v ?? null)) continue;
    if (v == null) delete details[f]; else details[f] = v;
    changed.push(f);
  }
  for (const f of SECRET_FIELDS) {
    if (!(f in patch)) continue;
    const v = patch[f];
    if (v == null) { if (f in secrets) { delete secrets[f]; changed.push(f); } continue; }
    secrets[f] = encryptSecret(v)!;
    changed.push(f);
  }
  if (datesOutOfOrder(details.startDate, details.endDate)) return bad("End date cannot be before the start date.");
  if (!changed.length) return ok(present(existing));

  const userId = (ctx.session!.user as any).id as string;
  const values = { details, secrets, updatedAt: new Date(), updatedBy: userId };
  let row;
  if (existing) {
    [row] = await db.update(personDetails).set(values).where(eq(personDetails.id, existing.id)).returning();
  } else {
    [row] = await db.insert(personDetails).values({ orgId: ctx.orgId!, resourceId: params.id, ...values })
      .onConflictDoUpdate({ target: personDetails.resourceId, set: values }).returning();
  }

  // Which fields changed, never their values — an audit row is read by more people than HR data is.
  await logEvent({
    orgId: ctx.orgId!, eventType: "person_details_updated",
    actorId: userId, actorName: (ctx.session!.user as any).name ?? null,
    meta: { resourceId: params.id, person: g.person.name, fields: changed },
  }).catch((e) => console.error("[personal-details] audit failed", e));

  return ok(present(row));
}
