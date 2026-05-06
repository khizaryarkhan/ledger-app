import { db } from "@/db";
import { communications, invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";

const Schema = z.object({
  customerId: z.string().uuid(),
  invoiceId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  direction: z.enum(["Inbound", "Outbound"]),
  channel: z.enum(["Email", "Note", "Phone", "Meeting"]),
  subject: z.string().optional(),
  sender: z.string().optional(),
  recipients: z.string().optional(),
  body: z.string().optional(),
  matchedBy: z.string().optional(),
  isDraft: z.boolean().default(false),
});

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const invoiceId = searchParams.get("invoiceId");

  let query = db.select().from(communications).where(eq(communications.orgId, orgId!)).$dynamic();
  if (invoiceId) query = query.where(eq(communications.invoiceId, invoiceId));
  else if (customerId) query = query.where(eq(communications.customerId, customerId));

  return ok(await query.orderBy(desc(communications.sentAt)));
}

export async function POST(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  try {
    const data = Schema.parse(await req.json());
    const [created] = await db.insert(communications).values({
      orgId: orgId!,
      orgId: orgId!,
      customerId: data.customerId,
      invoiceId: data.invoiceId ?? null,
      contactId: data.contactId ?? null,
      direction: data.direction,
      channel: data.channel,
      subject: data.subject,
      sender: data.sender,
      recipients: data.recipients,
      body: data.body,
      matchedBy: data.matchedBy,
      isDraft: data.isDraft ?? false,
      authorId: (session!.user as any).id,
    }).returning();

    if (data.invoiceId && !data.isDraft && data.channel === "Email" && data.direction === "Outbound") {
      const [inv] = await db.select().from(invoices).where(eq(invoices.id, data.invoiceId)).limit(1);
      if (inv) {
        const today = new Date().toISOString().slice(0, 10);
        const newStage = (inv.collectionStage === "New" || inv.collectionStage === "Reminder Scheduled")
          ? "Reminder Sent" : inv.collectionStage;
        await db.update(invoices).set({ lastFollowupDate: today, collectionStage: newStage, updatedAt: new Date() }).where(eq(invoices.id, data.invoiceId));
      }
    }

    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to create communication", 500);
  }
}
