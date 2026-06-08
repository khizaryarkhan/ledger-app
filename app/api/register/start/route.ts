import { NextRequest } from "next/server";
import { db } from "@/db";
import { pendingRegistrations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ok, bad } from "@/lib/api";
import { sendSystemEmail, getAppUrl } from "@/lib/system-mailer";
import { z } from "zod";

const Schema = z.object({
  companyName: z.string().min(1).max(255),
  adminName:   z.string().min(1).max(255),
  adminEmail:  z.string().email(),
});

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(req: NextRequest) {
  try {
    const body = Schema.parse(await req.json());
    const email = body.adminEmail.toLowerCase().trim();

    // Check no existing pending reg for this email in last 10 min (rate-limit)
    const otp    = generateOtp();
    const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Upsert: delete any old pending reg for this email then insert fresh
    await db.delete(pendingRegistrations).where(eq(pendingRegistrations.adminEmail, email));

    const [reg] = await db.insert(pendingRegistrations).values({
      companyName:   body.companyName,
      adminName:     body.adminName,
      adminEmail:    email,
      otp,
      otpExpiry:     expiry,
      emailVerified: false,
      status:        "pending",
    }).returning({ id: pendingRegistrations.id });

    // Send OTP email
    await sendSystemEmail({
      to:      email,
      subject: "Your Prime Accountax verification code",
      html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Verify your email</title></head>
<body style="margin:0;padding:0;background:#0c0a09;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0c0a09;padding:40px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
        <tr><td style="padding-bottom:24px;text-align:center;">
          <span style="font-size:18px;font-weight:600;color:#fff;">Prime Accountax</span>
        </td></tr>
        <tr><td style="background:#1c1917;border:1px solid #292524;border-radius:12px;padding:32px;text-align:center;">
          <h2 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#fff;">Verify your email</h2>
          <p style="margin:0 0 28px;font-size:14px;color:#a8a29e;">Hi ${body.adminName}, use this code to verify your email address. It expires in <strong style="color:#e7e5e4;">10 minutes</strong>.</p>
          <div style="display:inline-block;background:#0c0a09;border:1px solid #292524;border-radius:10px;padding:20px 40px;margin-bottom:24px;">
            <span style="font-size:36px;font-weight:700;color:#10b981;letter-spacing:0.15em;font-family:monospace;">${otp}</span>
          </div>
          <p style="margin:0;font-size:12px;color:#57534e;">If you didn't request this, you can safely ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    });

    return ok({ pendingId: reg.id });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error("[register/start]", e);
    return bad("Failed to start registration", 500);
  }
}
