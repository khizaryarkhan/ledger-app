import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { paymentRuns } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { logEvent } from "@/lib/audit";

const Schema = z.object({
  scheduledPaymentDate: z.string().min(1),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [run] = await db.select().from(paymentRuns)
    .where(and(eq(paymentRuns.id, params.id), eq(paymentRuns.orgId, orgId!)))
    .limit(1);
  if (!run) return bad("Payment run not found", 404);
  if (run.status !== "Approved") return bad("Only Approved payment runs can be scheduled", 400);

  try {
    const { scheduledPaymentDate } = Schema.parse(await req.json());
    const actorId   = (session?.user as any)?.id   ?? null;
    const actorName = (session?.user as any)?.name ?? null;

    const [updated] = await db.update(paymentRuns)
      .set({
        status:               "Scheduled",
        scheduledPaymentDate,
        updatedAt:            new Date(),
      })
      .where(and(eq(paymentRuns.id, params.id), eq(paymentRuns.orgId, orgId!)))
      .returning();

    await logEvent({
      orgId: orgId!,
      eventType: "payment_run_scheduled" as any,
      actorId,
      actorName,
      meta: { runNumber: run.runNumber, scheduledPaymentDate },
    });

    return ok(updated);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to schedule payment run", 500);
  }
}
