import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

// Temporary diagnostic endpoint — remove after debugging
export async function GET() {
  const checks: Record<string, any> = {};

  checks.env = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    AUTH_SECRET: !!process.env.AUTH_SECRET,
    NEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
    AUTH_URL: process.env.AUTH_URL || null,
  };

  try {
    const [user] = await db.select({
      id: users.id, email: users.email, role: users.role,
      status: users.status, hasHash: users.passwordHash,
    }).from(users).where(eq(users.email, "wajahat.khan86@yahoo.com")).limit(1);

    checks.user = user ? {
      found: true, role: user.role, status: user.status,
      hashStart: user.hasHash?.slice(0, 10),
    } : { found: false };

    if (user?.hasHash) {
      checks.bcrypt = await bcrypt.compare("Jasper15*!", user.hasHash);
    }
  } catch (e: any) {
    checks.dbError = e.message;
  }

  return NextResponse.json(checks);
}
