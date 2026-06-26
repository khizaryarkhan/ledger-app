import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAuth, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";

// GET /api/auth/mfa/status → { enabled, eligible }
export async function GET() {
  const { error, session } = await requireAuth();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const [u] = await db
    .select({ role: users.role, mfaEnabled: users.mfaEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return bad("Account not found", 404);

  // MFA is offered to platform administrators.
  return ok({ eligible: u.role === "super_admin" || u.role === "platform_admin", enabled: !!u.mfaEnabled });
}
