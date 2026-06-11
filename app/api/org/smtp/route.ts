import { db } from "@/db";
import { orgSmtpSettings } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { encryptSecret } from "@/lib/crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";

const Schema = z.object({
  host: z.string().min(1),
  port: z.number().int().default(2525),
  // user/pass are optional on edit: the GET never returns them (credential
  // surface), so a blank value means "keep the existing one".
  user: z.string().optional(),
  pass: z.string().optional(),
  fromEmail: z.string().email(),
  fromName: z.string().optional(),
  keepExistingPass: z.boolean().optional(),
  ccEmail: z.string().email().optional().or(z.literal("")),
  ccEnabled: z.boolean().optional(),
});

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [settings] = await db.select({
    id:        orgSmtpSettings.id,
    host:      orgSmtpSettings.host,
    port:      orgSmtpSettings.port,
    fromEmail: orgSmtpSettings.fromEmail,
    fromName:  orgSmtpSettings.fromName,
    ccEmail:   orgSmtpSettings.ccEmail,
    ccEnabled: orgSmtpSettings.ccEnabled,
    // Never return password or the SMTP username (credential surface).
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

    const ccEmail  = data.ccEmail  || null;
    const ccEnabled = data.ccEnabled ?? false;

    if (existing) {
      await db.update(orgSmtpSettings).set({
        host:      data.host,
        port:      data.port,
        ...(data.user ? { user: data.user } : {}),          // blank → keep existing
        ...(data.keepExistingPass || !data.pass ? {} : { pass: encryptSecret(data.pass)! }),
        fromEmail: data.fromEmail,
        fromName:  data.fromName,
        ccEmail,
        ccEnabled,
        updatedAt: new Date(),
      }).where(eq(orgSmtpSettings.orgId, orgId!));
    } else {
      if (!data.user) return bad("Username is required for new SMTP configuration", 400);
      if (!data.pass) return bad("Password is required for new SMTP configuration", 400);
      await db.insert(orgSmtpSettings).values({
        orgId: orgId!, host: data.host, port: data.port,
        user: data.user, pass: encryptSecret(data.pass)!,
        fromEmail: data.fromEmail, fromName: data.fromName,
        ccEmail, ccEnabled,
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
