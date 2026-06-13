import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions, tempAccessRequests, users } from "@/db/schema";
import { requireOrg } from "@/lib/api";
import { auth } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({
  reason: z.string().max(1000).optional(),
});

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const session = await auth();
  const userId  = (session?.user as any)?.id as string | undefined;

  // Only allow for cancelled subscriptions
  const [sub] = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId!))
    .limit(1);

  const isCanceled = sub?.status === "canceled" || sub?.status === "cancelled";
  if (!isCanceled) {
    return NextResponse.json({ error: "Subscription is not cancelled" }, { status: 400 });
  }

  // Prevent duplicate pending requests
  const [existing] = await db
    .select({ id: tempAccessRequests.id })
    .from(tempAccessRequests)
    .where(and(
      eq(tempAccessRequests.orgId, orgId!),
      eq(tempAccessRequests.status, "pending"),
    ))
    .limit(1);

  if (existing) {
    return NextResponse.json({ error: "A request is already pending review" }, { status: 409 });
  }

  const body  = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  const reason = parsed.success ? parsed.data.reason : undefined;

  // Fetch user email for the request record
  let userEmail: string | null = null;
  if (userId) {
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    userEmail = u?.email ?? null;
  }

  const [created] = await db.insert(tempAccessRequests).values({
    orgId:               orgId!,
    requestedByUserId:   userId ?? null,
    requestedByEmail:    userEmail,
    reason:              reason ?? null,
    status:              "pending",
  }).returning({ id: tempAccessRequests.id });

  return NextResponse.json({ id: created.id, status: "pending" }, { status: 201 });
}
