import { ok, bad } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/billing";
import { logActivity } from "@/lib/admin/activities";
import { getMailbox, sendMessage } from "@/lib/admin-mailbox";
import { db } from "@/db";
import { landingPageRequests, leadNotes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, userId, userName } = await requirePlatformAdmin();
  if (error) return error;

  const { subject, body, to: toOverride, cc, bcc } = await req.json().catch(() => ({}));
  if (!subject?.trim()) return bad("Subject is required");
  if (!body?.trim())    return bad("Body is required");

  const [lead] = await db
    .select({ email: landingPageRequests.email, fullName: landingPageRequests.fullName })
    .from(landingPageRequests)
    .where(eq(landingPageRequests.id, params.id))
    .limit(1);

  if (!lead) return bad("Lead not found", 404);

  const toAddress = (toOverride as string)?.trim() || lead.email;
  const ccList: string[]  = Array.isArray(cc)  ? cc.filter(Boolean)  : (typeof cc === "string" && cc.trim() ? cc.split(/[,;]+/).map((s: string) => s.trim()).filter(Boolean) : []);
  const bccList: string[] = Array.isArray(bcc) ? bcc.filter(Boolean) : (typeof bcc === "string" && bcc.trim() ? bcc.split(/[,;]+/).map((s: string) => s.trim()).filter(Boolean) : []);

  const html = body
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  // Real 1:1 communication must go from the admin's OWN connected mailbox —
  // never from the system support@ address. Require a connected mailbox.
  const authorId   = userId ?? null;
  const mailbox = authorId ? await getMailbox(authorId) : null;
  if (!mailbox) {
    return bad("Connect your mailbox under Mail to send from your own email address.", 409);
  }
  try {
    await sendMessage(mailbox, {
      to: toAddress,
      cc: ccList.length ? ccList.join(", ") : undefined,
      bcc: bccList.length ? bccList.join(", ") : undefined,
      subject: subject.trim(), html,
    });
  } catch (e: any) {
    return bad(`Send failed: ${e?.message ?? "unknown error"}`, 502);
  }

  // Log the email as an activity note so it appears in the activity panel
  const authorName = userName ?? "Admin";

  try {
    await db.insert(leadNotes).values({
      leadId:     params.id,
      authorId,
      authorName,
      body: JSON.stringify({
        _type:   "email",
        subject: subject.trim(),
        to:      toAddress,
        cc:      ccList.length > 0 ? ccList : undefined,
        preview: body.trim().slice(0, 400),
      }),
    });
  } catch {
    // Don't fail the send if the activity log write fails
  }

  await logActivity({
    type: "email_sent", title: `Email sent: ${subject.trim()}`.slice(0, 300),
    body: body.trim().slice(0, 300), leadId: params.id, actorId: authorId, actorName,
    meta: { to: toAddress, cc: ccList.length ? ccList : undefined },
  });

  return ok({ sent: true });
}
