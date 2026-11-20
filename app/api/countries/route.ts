import { db } from "@/db";
import { countries } from "@/db/schema";
import { requireOrg, requireReadScope, ok, bad } from "@/lib/api";
import { eq, and, inArray } from "drizzle-orm";
import { countryCodeError, normaliseCountryCode, countryCodeFromName } from "@/lib/countries";

export async function GET() {
  const { error, orgIds } = await requireReadScope();
  if (error) return error;
  const all = await db.select().from(countries).where(inArray(countries.orgId, orgIds));
  return ok(all);
}

/**
 * The org's own country list (what regions and rep books group by). Each entry
 * carries the ISO 3166 code its name means (0139), so a party that picks from
 * the list gets a code for EDI without a second picker. An explicit isoCode
 * wins; otherwise the name is matched exactly (lib/countries.ts), and a name
 * that matches nothing is stored with no code rather than a guessed one.
 */
export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const { name, isoCode } = await req.json();
  if (!name?.trim()) return bad("Name is required");
  const e = countryCodeError(isoCode, "ISO code");
  if (e) return bad(e);
  const code = normaliseCountryCode(isoCode) ?? countryCodeFromName(name);
  const [country] = await db.insert(countries).values({ orgId: orgId!, name: name.trim(), isoCode: code }).returning();
  return ok(country);
}

/** Set (or clear) the ISO code of an existing list entry. */
export async function PATCH(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const { id, isoCode } = await req.json().catch(() => ({}));
  if (!id) return bad("id required");
  const e = countryCodeError(isoCode, "ISO code");
  if (e) return bad(e);
  const [row] = await db.update(countries).set({ isoCode: normaliseCountryCode(isoCode) })
    .where(and(eq(countries.id, String(id)), eq(countries.orgId, orgId!))).returning();
  if (!row) return bad("Country not found", 404);
  return ok(row);
}

export async function DELETE(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const { id } = await req.json();
  if (!id) return bad("id required");
  await db.delete(countries).where(and(eq(countries.id, id), eq(countries.orgId, orgId!)));
  return ok({ deleted: true });
}
