import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { landingPageRequests, leadContacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getMailbox, searchInboundFrom } from "@/lib/admin-mailbox";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET — inbound replies from this lead, pulled live from the admin's mailbox and
// matched against the lead's + contacts' email addresses.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const cfg = await getMailbox(userId as string);
  if (!cfg) return NextResponse.json({ connected: false, emails: [] });

  // Gather every address that represents this lead.
  const addrs = new Set<string>();
  const [lead] = await db.select({ email: landingPageRequests.email }).from(landingPageRequests).where(eq(landingPageRequests.id, params.id)).limit(1);
  if (lead?.email) addrs.add(lead.email);
  try {
    const contacts = await db.select({ email: leadContacts.email }).from(leadContacts).where(eq(leadContacts.leadId, params.id));
    for (const c of contacts) if (c.email) addrs.add(c.email);
  } catch { /* table may not exist yet */ }

  if (addrs.size === 0) return NextResponse.json({ connected: true, emails: [] });

  try {
    const emails = await searchInboundFrom(cfg, [...addrs]);
    return NextResponse.json({ connected: true, emails });
  } catch (e: any) {
    return NextResponse.json({ connected: true, emails: [], error: e?.message ?? "mailbox search failed" });
  }
}
