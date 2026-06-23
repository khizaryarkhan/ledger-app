import { requirePlatformAdmin } from "@/lib/billing";
import { NextRequest, NextResponse } from "next/server";
import { getMailbox, getMessage } from "@/lib/admin-mailbox";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET — one message's full parsed content (?mailbox=INBOX).
export async function GET(req: NextRequest, { params }: { params: { uid: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const cfg = await getMailbox(userId as string);
  if (!cfg) return NextResponse.json({ error: "No mailbox connected" }, { status: 409 });

  const uid = parseInt(params.uid);
  if (isNaN(uid)) return NextResponse.json({ error: "Bad message id" }, { status: 400 });
  const mailbox = new URL(req.url).searchParams.get("mailbox") || "INBOX";

  try {
    const message = await getMessage(cfg, uid, mailbox);
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    return NextResponse.json({ message });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Could not load message" }, { status: 502 });
  }
}
