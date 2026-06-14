import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { sendSystemEmail } from "@/lib/system-mailer";
import { db } from "@/db";
import { landingPageRequests } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const { subject, body } = await req.json().catch(() => ({}));
  if (!subject?.trim()) return bad("Subject is required");
  if (!body?.trim())    return bad("Body is required");

  const [lead] = await db
    .select({ email: landingPageRequests.email, fullName: landingPageRequests.fullName })
    .from(landingPageRequests)
    .where(eq(landingPageRequests.id, params.id))
    .limit(1);

  if (!lead) return bad("Lead not found", 404);

  const html = body
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  await sendSystemEmail({
    to:      lead.email,
    subject: subject.trim(),
    html,
  });

  return ok({ sent: true });
}
