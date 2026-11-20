/**
 * Supplier contacts (0142), the server half. Rules: lib/party-terms.ts
 * (contactValues). One primary per party is settled by a partial unique index;
 * the current primary is stood down FIRST (no transactions on neon-http).
 */

import { db } from "@/db";
import { partyContacts, parties } from "@/db/schema";
import { and, eq, ne, asc, desc } from "drizzle-orm";
import { contactValues } from "@/lib/party-terms";

export class ContactError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const contactErrorOf = (e: unknown) => (e instanceof ContactError ? e : null);
const isUniqueViolation = (e: any) => e?.code === "23505" || /duplicate key|unique constraint/i.test(String(e?.message ?? ""));

async function requireSupplier(orgId: string, partyId: string) {
  const [p] = await db.select({ id: parties.id }).from(parties)
    .where(and(eq(parties.id, partyId), eq(parties.orgId, orgId), eq(parties.partyType, "supplier"))).limit(1);
  if (!p) throw new ContactError("Supplier not found.", 404);
}

async function standDownPrimary(orgId: string, partyId: string, exceptId?: string) {
  await db.update(partyContacts).set({ isPrimary: false, updatedAt: new Date() })
    .where(and(eq(partyContacts.orgId, orgId), eq(partyContacts.partyId, partyId), eq(partyContacts.isPrimary, true), ...(exceptId ? [ne(partyContacts.id, exceptId)] : [])));
}

export async function listContacts(orgId: string, partyId: string) {
  return db.select().from(partyContacts).where(and(eq(partyContacts.orgId, orgId), eq(partyContacts.partyId, partyId)))
    .orderBy(desc(partyContacts.isPrimary), asc(partyContacts.name));
}

export async function createContact(orgId: string, partyId: string, body: any) {
  await requireSupplier(orgId, partyId);
  const r = contactValues(body, { creating: true });
  if ("error" in r) throw new ContactError(r.error);
  // The first contact a supplier gets is its primary one.
  const isPrimary = r.values.isPrimary === true || (await listContacts(orgId, partyId)).length === 0;
  if (isPrimary) await standDownPrimary(orgId, partyId);
  try {
    const [row] = await db.insert(partyContacts).values({ ...r.values, name: r.values.name!, orgId, partyId, isPrimary } as any).returning();
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new ContactError("Another primary contact was saved for this supplier at the same moment. Reload and check.", 409);
    throw e;
  }
}

export async function updateContact(orgId: string, partyId: string, id: string, body: any) {
  const [existing] = await db.select().from(partyContacts)
    .where(and(eq(partyContacts.id, id), eq(partyContacts.orgId, orgId), eq(partyContacts.partyId, partyId))).limit(1);
  if (!existing) throw new ContactError("Contact not found.", 404);
  const r = contactValues(body, { creating: false, current: existing });
  if ("error" in r) throw new ContactError(r.error);
  if (r.values.isPrimary && !existing.isPrimary) await standDownPrimary(orgId, partyId, id);
  try {
    const [row] = await db.update(partyContacts).set({ ...r.values, updatedAt: new Date() } as any)
      .where(and(eq(partyContacts.id, id), eq(partyContacts.orgId, orgId))).returning();
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new ContactError("Another primary contact was saved for this supplier at the same moment. Reload and check.", 409);
    throw e;
  }
}

export async function deleteContact(orgId: string, partyId: string, id: string) {
  const r = await db.delete(partyContacts)
    .where(and(eq(partyContacts.id, id), eq(partyContacts.orgId, orgId), eq(partyContacts.partyId, partyId))).returning({ id: partyContacts.id });
  if (!r.length) throw new ContactError("Contact not found.", 404);
}
