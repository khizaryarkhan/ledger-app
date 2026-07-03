/**
 * POST /api/communications/batch
 *
 * Inserts the same communication record across multiple invoices in a single
 * DB transaction. Used for batch "Log Chase" on the collections board.
 *
 * Body: {
 *   invoiceIds: string[]   // must all belong to this org
 *   channel:    string     // "Chase" | "Note"
 *   direction:  string     // "Outbound"
 *   subject?:   string
 *   body?:      string
 *   sentAt?:    string     // ISO — for backdating
 *   refNumber?: string
 * }
 */

import { db } from "@/db";
import { communications, invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";

const Schema = z.object({
  invoiceIds: z.array(z.string().uuid()).min(1).max(500),
  channel:    z.enum(["Chase", "Note"]),
  direction:  z.enum(["Outbound"]),
  subject:    z.string().max(512).optional(),
  body:       z.string().optional(),
  sentAt:     z.string().optional(),
  refNumber:  z.string().max(32).optional(),
});

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await req.json());
  } catch (e: any) {
    return bad(e?.issues?.[0]?.message ?? "Invalid request");
  }

  const actorId   = (session?.user as any)?.id   ?? null;
  const actorName = (session?.user as any)?.name ?? "Staff";
  const sentAt    = body.sentAt ? new Date(body.sentAt) : new Date();

  // Confirm all invoices belong to this org and grab their customerId/projectId.
  const targets = await db
    .select({ id: invoices.id, customerId: invoices.customerId, projectId: invoices.projectId })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId!), inArray(invoices.id, body.invoiceIds)));

  if (targets.length === 0) return bad("No matching invoices found", 404);

  await db.insert(communications).values(
    targets.map(inv => ({
      orgId:      orgId!,
      customerId: inv.customerId,
      projectId:  inv.projectId ?? null,
      invoiceId:  inv.id,
      direction:  body.direction,
      channel:    body.channel,
      subject:    body.subject ?? null,
      body:       body.body ?? null,
      sender:     actorName,
      matchedBy:  "Manual",
      isDraft:    false,
      sentAt,
      refNumber:  body.refNumber ?? null,
      ...(actorId ? { authorId: actorId } : {}),
    }))
  );

  return ok({ created: targets.length });
}
