import { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ok, bad } from "@/lib/api";
import { sendSystemEmail, renderPasswordResetEmail, getAppUrl } from "@/lib/system-mailer";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string") return bad("Email is required");

    const normalised = email.toLowerCase().trim();

    // Throttle reset requests per IP and per target email (token-generation abuse).
    const ipLimit = await rateLimit(`forgot:ip:${clientIp(req)}`, 5, 3600);
    if (!ipLimit.ok) return bad("Too many requests. Please try again later.", 429);
    const emailLimit = await rateLimit(`forgot:email:${normalised}`, 3, 3600);
    if (!emailLimit.ok) {
      // Don't reveal whether the email exists — return the same generic success.
      return ok({ message: "If that email exists, a reset link has been sent." });
    }

    const [user] = await db
      .select({ id: users.id, name: users.name, email: users.email, status: users.status })
      .from(users)
      .where(eq(users.email, normalised))
      .limit(1);

    // Always return success to prevent email enumeration
    if (!user || user.status !== "Active") {
      return ok({ message: "If that email exists, a reset link has been sent." });
    }

    // Generate a secure random token
    const token = crypto.randomBytes(32).toString("hex");
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db
      .update(users)
      .set({ resetToken: token, resetTokenExpiry: expiry })
      .where(eq(users.id, user.id));

    const resetUrl = `${getAppUrl()}/reset-password?token=${token}`;

    await sendSystemEmail({
      to:      user.email,
      subject: "Reset your Prime Accountax password",
      html:    renderPasswordResetEmail({ name: user.name, resetUrl }),
    });

    return ok({ message: "If that email exists, a reset link has been sent." });
  } catch (e: any) {
    console.error("[forgot-password]", e);
    // Don't leak internal errors
    return ok({ message: "If that email exists, a reset link has been sent." });
  }
}
