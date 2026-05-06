import { db } from "@/db";
import { invoices } from "@/db/schema";
import { requireAuth, ok, bad } from "@/lib/api";
import { z } from "zod";
import { eq } from "drizzle-orm";

const Schema = z.object({ amount: z.number().positive() });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAuth();
  if (error) return error;
  try {
    const { amount } = Schema.parse(await req.json());
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, params.id)).limit(1);
    if (!inv) return bad("Invoice not found", 404);

    const newPaid = (inv.paid || 0) + amount;
    const isPaid = newPaid >= inv.total - 0.01;

    const [updated] = await db.update(invoices).set({
      paid: newPaid,
      paymentStatus: isPaid ? "Paid" : "Partially Paid",
      collectionStage: isPaid ? "Closed" : inv.collectionStage,
      updatedAt: new Date(),
    }).where(eq(invoices.id, params.id)).returning();

    return ok(updated);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to record payment", 500);
  }
}
