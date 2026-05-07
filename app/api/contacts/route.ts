import { db } from "@/db";
import { contacts } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";

const Schema = z.object({
  customerId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(255),
  title: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  type: z.enum(["Billing", "Finance", "Project", "Escalation", "Legal", "Other"]).default("Billing"),
  isPrimary: z.boolean().default(false),
  isEscalation: z.boolean().default(false),
  receivesAuto: z.boolean().default(true),
});

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const projectId = searchParams.get("projectId");
  if (projectId) return ok(await db.select().from(contacts).where(and(eq(contacts.orgId, orgId!), eq(contacts.projectId, projectId))));
  if (customerId) return ok(await db.select().from(contacts).where(and(eq(contacts.orgId, orgId!), eq(contacts.customerId, customerId))));
  return ok(await db.select().from(contacts).where(eq(contacts.orgId, orgId!)));
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  try {
    const data = Schema.parse(await req.json());
    const [created] = await db.insert(contacts).values({
      orgId: orgId!,
      customerId: data.customerId,
      projectId: data.projectId ?? null,
      name: data.name,
      title: data.title,
      email: data.email,
      phone: data.phone,
      type: data.type ?? "Billing",
      isPrimary: data.isPrimary ?? false,
      isEscalation: data.isEscalation ?? false,
      receivesAuto: data.receivesAuto ?? true,
    }).returning();
    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to create contact", 500);
  }
}
