import { db } from "@/db";
import { users, reps } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";

const Schema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  const repId = params.id;

  // Verify rep belongs to this org
  const [rep] = await db.select().from(reps).where(and(eq(reps.id, repId), eq(reps.orgId, orgId!))).limit(1);
  if (!rep) return bad("Rep not found", 404);

  let body: any;
  try { body = Schema.parse(await req.json()); }
  catch (e: any) { return bad(e.issues?.[0]?.message || "Invalid input"); }

  const hash = await bcrypt.hash(body.password, 10);

  // Derive a login email: use rep's email if set, else generate one
  const loginEmail = rep.email
    ? rep.email.toLowerCase().trim()
    : `rep.${repId.slice(0, 8)}@internal.ledger`;

  // Upsert: if a user with this repId already exists, update; else create
  const [existing] = await db.select().from(users).where(eq(users.repId, repId)).limit(1);

  if (existing) {
    await db.update(users).set({ passwordHash: hash, status: "Active" }).where(eq(users.id, existing.id));
    return ok({ updated: true, email: existing.email });
  }

  const [created] = await db.insert(users).values({
    email: loginEmail,
    passwordHash: hash,
    name: rep.name,
    role: "rep",
    orgId: orgId!,
    repId: repId,
    status: "Active",
  }).returning();

  return ok({ created: true, email: created.email });
}

/** GET — check if a rep has a login account */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  const repId = params.id;
  const [existing] = await db.select({ id: users.id, email: users.email, status: users.status })
    .from(users).where(eq(users.repId, repId)).limit(1);

  return ok({ hasLogin: !!existing, email: existing?.email || null, status: existing?.status || null });
}
