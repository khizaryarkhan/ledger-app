import { requireAuth, ok } from "@/lib/api";

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;
  const configured = !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM
  );
  return ok({ configured, from: process.env.SMTP_FROM || "" });
}
