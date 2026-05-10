import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";
import { logEvent } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [c] = await db.select().from(customers).where(eq(customers.id, params.id)).limit(1);
  if (!c) return bad("Not found", 404);
  return ok(c);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const [before] = await db.select().from(customers).where(eq(customers.id, params.id)).limit(1);
  if (!before) return bad("Not found", 404);

  const body = await req.json();
  const [updated] = await db.update(customers)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(customers.id, params.id))
    .returning();
  if (!updated) return bad("Not found", 404);

  const actorId   = (session?.user as any)?.id   ?? null;
  const actorName = (session?.user as any)?.name ?? null;
  const base = { orgId: orgId!, customerId: updated.id, actorId, actorName };

  // ── Chase mode changed ─────────────────────────────────────────────────────
  if (body.chaseByProject !== undefined && body.chaseByProject !== before.chaseByProject) {
    await logEvent({
      ...base,
      eventType: "chase_mode_changed",
      meta: {
        chaseByProject: body.chaseByProject,
        mode: body.chaseByProject ? "By Project" : "By Customer",
        customerName: updated.name,
      },
    });
  }

  // ── Programme toggled (autoReminders field) ───────────────────────────────
  if (body.autoReminders !== undefined && body.autoReminders !== before.autoReminders) {
    await logEvent({
      ...base,
      eventType: "programme_toggled",
      meta: {
        enabled: body.autoReminders,
        customerName: updated.name,
      },
    });
  }

  return ok(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  await db.delete(customers).where(eq(customers.id, params.id));
  return ok({ ok: true });
}
