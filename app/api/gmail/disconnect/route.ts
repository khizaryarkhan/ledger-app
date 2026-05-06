import { db } from "@/db";
import { gmailTokens } from "@/db/schema";
import { requireAuth, ok } from "@/lib/api";
import { eq } from "drizzle-orm";

export async function POST() {
  const { error, session } = await requireAuth();
  if (error) return error;
  await db.delete(gmailTokens).where(eq(gmailTokens.userId, (session!.user as any).id));
  return ok({ disconnected: true });
}
