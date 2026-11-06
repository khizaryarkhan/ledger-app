/**
 * Server half of personal-details.ts: one load and one update, used by BOTH the
 * admin route (/api/resources/[id]/personal-details) and the self-service route
 * (/api/resources/me/personal-details), so the two cannot drift apart.
 * Callers must already have proven the resource is a person in `orgId` and
 * that the caller may act on it.
 */
import { db } from "@/db";
import { personDetails } from "@/db/schema";
import { logEvent } from "@/lib/audit";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import {
  PLAIN_FIELDS, SECRET_FIELDS, SELF_LOCKED_FIELDS, maskSecret, parseDetailsPatch, datesOutOfOrder,
} from "./personal-details";
import { and, eq } from "drizzle-orm";

type Row = typeof personDetails.$inferSelect;

export function presentDetails(row: Pick<Row, "details" | "secrets" | "updatedAt"> | undefined) {
  const details: Record<string, string> = {};
  for (const f of PLAIN_FIELDS) if (row?.details?.[f]) details[f] = row.details[f];
  const secrets: Record<string, ReturnType<typeof maskSecret>> = {};
  for (const f of SECRET_FIELDS) secrets[f] = maskSecret(decryptSecret(row?.secrets?.[f] ?? null));
  return { details, secrets, updatedAt: row?.updatedAt ?? null };
}

async function loadRow(orgId: string, resourceId: string): Promise<Row | undefined> {
  const [row] = await db.select().from(personDetails)
    .where(and(eq(personDetails.resourceId, resourceId), eq(personDetails.orgId, orgId))).limit(1);
  return row;
}

export async function loadDetails(orgId: string, resourceId: string) {
  return presentDetails(await loadRow(orgId, resourceId));
}

export async function updateDetails(
  orgId: string,
  resourceId: string,
  body: unknown,
  actor: { id: string; name: string | null },
  opts: { self: boolean; personName: string },
): Promise<{ error: string; status?: number } | { result: ReturnType<typeof presentDetails> }> {
  // UTC today + 1 day, so someone west of Greenwich entering today's date is never refused.
  const tomorrowUtc = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const parsed = parseDetailsPatch((body ?? {}) as Record<string, unknown>, tomorrowUtc);
  if ("error" in parsed) return { error: parsed.error };
  const patch = parsed.patch;

  const existing = await loadRow(orgId, resourceId);
  const details: Record<string, string> = { ...(existing?.details ?? {}) };
  const secrets: Record<string, string> = { ...(existing?.secrets ?? {}) };
  const changed: string[] = [];

  for (const f of PLAIN_FIELDS) {
    if (!(f in patch)) continue;
    const v = patch[f];
    if ((details[f] ?? null) === (v ?? null)) continue;
    // Refused, not ignored: a field that silently does not save reads as saved.
    if (opts.self && (SELF_LOCKED_FIELDS as readonly string[]).includes(f)) {
      return { error: "Employment details (number, job title, type and dates) are changed by your administrator.", status: 403 };
    }
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
  if (datesOutOfOrder(details.startDate, details.endDate)) return { error: "End date cannot be before the start date." };
  if (!changed.length) return { result: presentDetails(existing) };

  const values = { details, secrets, updatedAt: new Date(), updatedBy: actor.id };
  const [row] = existing
    ? await db.update(personDetails).set(values).where(eq(personDetails.id, existing.id)).returning()
    : await db.insert(personDetails).values({ orgId, resourceId, ...values })
        .onConflictDoUpdate({ target: personDetails.resourceId, set: values }).returning();

  // Which fields changed, never their values — an audit row is read by more people than HR data is.
  await logEvent({
    orgId, eventType: "person_details_updated",
    actorId: actor.id, actorName: actor.name,
    meta: { resourceId, person: opts.personName, fields: changed, selfService: opts.self },
  }).catch((e) => console.error("[personal-details] audit failed", e));

  return { result: presentDetails(row) };
}
