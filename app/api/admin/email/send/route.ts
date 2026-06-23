import { requirePlatformAdmin } from "@/lib/billing";
import { NextRequest, NextResponse } from "next/server";
import { getMailbox, sendMessage } from "@/lib/admin-mailbox";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST — send an email from the admin's connected mailbox.
export async function POST(req: NextRequest) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const cfg = await getMailbox(userId as string);
  if (!cfg) return NextResponse.json({ error: "No mailbox connected" }, { status: 409 });

  const b = await req.json().catch(() => ({}));
  const to = String(b.to ?? "").trim();
  const subject = String(b.subject ?? "").trim();
  if (!to) return NextResponse.json({ error: "Recipient is required" }, { status: 400 });

  try {
    const result = await sendMessage(cfg, {
      to,
      cc: typeof b.cc === "string" ? b.cc.trim() : undefined,
      subject: subject || "(no subject)",
      html: typeof b.html === "string" ? b.html : undefined,
      text: typeof b.text === "string" ? b.text : undefined,
    });
    return NextResponse.json({ sent: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Send failed" }, { status: 502 });
  }
}
