import { db } from "@/db";
import { invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { logEvent } from "@/lib/audit";

const Schema = z.object({
  amount: z.number().positive(),
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // YYYY-MM-DD
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  try {
    const { amount, paidDate } = Schema.parse(await req.json());
    const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!))).limit(1);
    if (!inv) return bad("Invoice not found", 404);

    const newPaid = (inv.paid || 0) + amount;
    const isPaid  = newPaid >= inv.total - 0.01;
    const today   = new Date().toISOString().slice(0, 10);

    const [updated] = await db.update(invoices).set({
      paid: newPaid,
      paymentStatus: isPaid ? "Paid" : "Partially Paid",
      collectionStage: isPaid ? "Closed" : inv.collectionStage,
      ...(isPaid ? { paidAt: paidDate || today } : {}),
      updatedAt: new Date(),
    }).where(eq(invoices.id, params.id)).returning();

    // ── Audit log ─────────────────────────────────────────────────────────────
    await logEvent({
      orgId:      orgId!,
      eventType:  "payment_recorded",
      customerId: inv.customerId,
      projectId:  inv.projectId ?? null,
      invoiceId:  inv.id,
      actorId:    (session?.user as any)?.id   ?? null,
      actorName:  (session?.user as any)?.name ?? null,
      meta: {
        amount,
        currency:  inv.currency,
        invoiceNo: inv.invoiceNumber,
        isPaid,
        totalPaid: newPaid,
        invoiceTotal: inv.total,
      },
    });

    return ok(updated);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to record payment", 500);
  }
}
