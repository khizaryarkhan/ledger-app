import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { sendSystemEmail } from "@/lib/system-mailer";
import { db } from "@/db";
import { landingPageRequests, leadNotes } from "@/db/schema";
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

  // Log the email as an activity note so it appears in the activity panel
  const authorName = (session as any).user?.name ?? "Admin";
  const authorId   = (session as any).user?.id ?? null;

  try {
    await db.insert(leadNotes).values({
      leadId:     params.id,
      authorId,
      authorName,
      body: JSON.stringify({
        _type:   "email",
        subject: subject.trim(),
        preview: body.trim().slice(0, 400),
      }),
    });
  } catch {
    // Don't fail the send if the activity log write fails
  }

  return ok({ sent: true });
}
