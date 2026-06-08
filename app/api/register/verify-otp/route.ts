import { NextRequest } from "next/server";
import { db } from "@/db";
import { pendingRegistrations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { ok, bad } from "@/lib/api";
import { z } from "zod";

const Schema = z.object({
  pendingId: z.string().uuid(),
  otp:       z.string().length(6),
});

export async function POST(req: NextRequest) {
  try {
    const { pendingId, otp } = Schema.parse(await req.json());

    const [reg] = await db
      .select()
      .from(pendingRegistrations)
      .where(eq(pendingRegistrations.id, pendingId))
      .limit(1);

    if (!reg) return bad("Registration not found", 404);
    if (reg.status === "completed") return bad("Registration already completed");
    if (reg.emailVerified) return ok({ verified: true }); // already verified, idempotent

    if (reg.otp !== otp.trim()) return bad("Invalid verification code", 400);
    if (new Date() > new Date(reg.otpExpiry)) return bad("Verification code has expired. Please go back and request a new one.", 400);

    await db
      .update(pendingRegistrations)
      .set({ emailVerified: true, status: "email_verified" })
      .where(eq(pendingRegistrations.id, pendingId));

    return ok({ verified: true });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error("[register/verify-otp]", e);
    return bad("Failed to verify code", 500);
  }
}
