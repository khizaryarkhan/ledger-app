import { requireOrg, ok } from "@/lib/api";
import { db } from "@/db";
import { orgSmtpSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  // Check org-specific SMTP settings first.
  // IMPORTANT: select only the columns needed — do NOT use db.select() (fetches full row
  // including the encrypted password, which would be sent to the client in a mis-route).
  const [orgSmtp] = await db
    .select({
      host:      orgSmtpSettings.host,
      user:      orgSmtpSettings.user,
      pass:      orgSmtpSettings.pass,
      fromEmail: orgSmtpSettings.fromEmail,
    })
    .from(orgSmtpSettings)
    .where(eq(orgSmtpSettings.orgId, orgId!))
    .limit(1);

  if (orgSmtp?.host && orgSmtp?.user && orgSmtp?.pass && orgSmtp?.fromEmail) {
    return ok({
      configured: true,
      from: orgSmtp.fromEmail,
      source: "org" as const,
    });
  }

  // Each org must configure their own SMTP — no global env var fallback.
  return ok({ configured: false, from: "", source: "none" as const });
}
