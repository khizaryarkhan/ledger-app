import { db } from "@/db";
import { orgSmtpSettings } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";
import { z } from "zod";

const Schema = z.object({
  host: z.string().min(1),
  port: z.number().int().default(2525),
  user: z.string().min(1),
  pass: z.string().optional(), // optional on edit (keepExistingPass=true)
  fromEmail: z.string().email(),
  fromName: z.string().optional(),
  keepExistingPass: z.boolean().optional(),
});

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [settings] = await db.select({
    id: orgSmtpSettings.id,
    host: orgSmtpSettings.host,
    port: orgSmtpSettings.port,
    user: orgSmtpSettings.user,
    fromEmail: orgSmtpSettings.fromEmail,
    fromName: orgSmtpSettings.fromName,
    // Never return password
  }).from(orgSmtpSettings).where(eq(orgSmtpSettings.orgId, orgId!)).limit(1);

  return ok({ configured: !!settings, settings: settings || null });
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  try {
    const data = Schema.parse(await req.json());
    const [existing] = await db.select().from(orgSmtpSettings).where(eq(orgSmtpSettings.orgId, orgId!)).limit(1);

    if (existing) {
      await db.update(orgSmtpSettings).set({
        host: data.host,
        port: data.port,
        user: data.user,
        // Only update password if a new one was provided
        ...(data.keepExistingPass || !data.pass ? {} : { pass: data.pass }),
        fromEmail: data.fromEmail,
        fromName: data.fromName,
        updatedAt: new Date(),
      }).where(eq(orgSmtpSettings.orgId, orgId!));
    } else {
      if (!data.pass) return bad("Password is required for new SMTP configuration", 400);
      await db.insert(orgSmtpSettings).values({
        orgId: orgId!, host: data.host, port: data.port,
        user: data.user, pass: data.pass!,
        fromEmail: data.fromEmail, fromName: data.fromName,
      });
    }

    return ok({ saved: true });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to save SMTP settings", 500);
  }
}

export async function DELETE() {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  await db.delete(orgSmtpSettings).where(eq(orgSmtpSettings.orgId, orgId!));
  return ok({ deleted: true });
}
