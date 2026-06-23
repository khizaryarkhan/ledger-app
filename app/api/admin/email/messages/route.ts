import { requirePlatformAdmin } from "@/lib/billing";
import { NextRequest, NextResponse } from "next/server";
import { getMailbox, listMessages } from "@/lib/admin-mailbox";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET — list recent messages in a mailbox (?mailbox=INBOX&limit=50).
export async function GET(req: NextRequest) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const cfg = await getMailbox(userId as string);
  if (!cfg) return NextResponse.json({ error: "No mailbox connected" }, { status: 409 });

  const url = new URL(req.url);
  const mailbox = url.searchParams.get("mailbox") || "INBOX";
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get("limit") || "50")));

  try {
    const messages = await listMessages(cfg, mailbox, limit);
    return NextResponse.json({ messages });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Could not load mailbox" }, { status: 502 });
  }
}
