import { db } from "@/db";
import { tasks } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";

const Schema = z.object({
  customerId: z.string().uuid().nullable().optional(),
  invoiceId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(512),
  description: z.string().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).default("Medium"),
  labels: z.array(z.string()).default([]),
});

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { searchParams } = new URL(req.url);
  const invoiceId = searchParams.get("invoiceId");
  const customerId = searchParams.get("customerId");
  let query = db.select().from(tasks).$dynamic();
  query = query.where(eq(tasks.orgId, orgId!));
  if (invoiceId) query = query.where(eq(tasks.invoiceId, invoiceId));
  else if (customerId) query = query.where(eq(tasks.customerId, customerId));
  return ok(await query.orderBy(desc(tasks.createdAt)));
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  try {
    const data = Schema.parse(await req.json());
    const [created] = await db.insert(tasks).values({
      orgId: orgId!,
      orgId: orgId!,
      customerId: data.customerId ?? null,
      invoiceId: data.invoiceId ?? null,
      title: data.title,
      description: data.description,
      assigneeId: data.assigneeId ?? null,
      dueDate: data.dueDate,
      priority: data.priority ?? "Medium",
      labels: data.labels ?? [],
    }).returning();
    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to create task", 500);
  }
}
