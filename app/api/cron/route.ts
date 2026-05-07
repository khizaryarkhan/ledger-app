import { NextResponse } from "next/server";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { lt, eq, and, ne } from "drizzle-orm";

// This runs on Vercel Cron daily at 9am UTC. See vercel.json
export async function GET(req: Request) {
  // Verify cron secret to prevent random people from triggering it
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Find invoices that need stage transitions
  // Auto-schedule: promote 'New' -> 'Scheduled' for invoices due in 3 days
  const all = await db.select().from(invoices);
  let updated = 0;

  for (const inv of all) {
    if (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off") continue;
    const dueDate = new Date(inv.dueDate);
    const daysUntilDue = Math.floor((dueDate.getTime() - Date.now()) / 86400000);

    // Auto-escalate: 30+ days overdue, not in a manual/protected stage
    const PROTECTED_STAGES = ["Disputed", "Escalated", "On Hold", "Promised", "Promise to Pay", "Final Notice"];
    if (daysUntilDue < -30 && !PROTECTED_STAGES.includes(inv.collectionStage)) {
      await db.update(invoices).set({ collectionStage: "Escalated", updatedAt: new Date() }).where(eq(invoices.id, inv.id));
      updated++;
    }
  }

  return NextResponse.json({ ran: today, updated });
}
