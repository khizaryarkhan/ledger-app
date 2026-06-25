import { ok, bad } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { leadSequenceEnrollments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; enrollmentId: string } },
) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  // Cancel rather than hard-delete so history is preserved
  const [enrollment] = await db
    .update(leadSequenceEnrollments)
    .set({ status: "cancelled" })
    .where(and(
      eq(leadSequenceEnrollments.id,     params.enrollmentId),
      eq(leadSequenceEnrollments.leadId, params.id),
    ))
    .returning();

  if (!enrollment) return bad("Enrollment not found", 404);
  return ok(enrollment);
}
