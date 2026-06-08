import { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ok, bad } from "@/lib/api";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json();

    if (!token || typeof token !== "string") return bad("Invalid or missing token");
    if (!password || typeof password !== "string" || password.length < 8) {
      return bad("Password must be at least 8 characters");
    }

    const [user] = await db
      .select({ id: users.id, resetToken: users.resetToken, resetTokenExpiry: users.resetTokenExpiry })
      .from(users)
      .where(eq(users.resetToken, token))
      .limit(1);

    if (!user || !user.resetToken || !user.resetTokenExpiry) {
      return bad("Invalid or expired reset link", 400);
    }

    if (new Date() > new Date(user.resetTokenExpiry)) {
      // Clear the expired token
      await db
        .update(users)
        .set({ resetToken: null, resetTokenExpiry: null })
        .where(eq(users.id, user.id));
      return bad("This reset link has expired. Please request a new one.", 400);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await db
      .update(users)
      .set({ passwordHash, resetToken: null, resetTokenExpiry: null })
      .where(eq(users.id, user.id));

    return ok({ message: "Password updated successfully." });
  } catch (e: any) {
    console.error("[reset-password]", e);
    return bad("Failed to reset password", 500);
  }
}
