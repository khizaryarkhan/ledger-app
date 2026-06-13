import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users, userOrganisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/audit";
import { verifyTotp, consumeRecoveryCode } from "@/lib/mfa";
import { decryptSecret } from "@/lib/crypto";

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // 8 hours — re-login required after inactivity
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        mfaCode: { label: "Authentication code", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = String(credentials.email).toLowerCase().trim();

        // Throttle password attempts per email to blunt online brute-forcing.
        const rl = await rateLimit(`login:${email}`, 10, 900);
        if (!rl.ok) return null;

        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user || user.status !== "Active") return null;
        const valid = await bcrypt.compare(String(credentials.password), user.passwordHash);
        if (!valid) return null;

        // ── Multi-factor gate ──────────────────────────────────────────────
        // Only blocks users who have ENROLLED (mfaEnabled). A valid TOTP or a
        // one-time recovery code is required; recovery codes are consumed.
        if ((user as any).mfaEnabled) {
          const code = credentials.mfaCode ? String(credentials.mfaCode) : "";
          if (!code) return null;
          const secret = (user as any).mfaSecret ? decryptSecret((user as any).mfaSecret) : null;
          const totpOk = secret ? verifyTotp(code, secret) : false;
          if (!totpOk) {
            const remaining = await consumeRecoveryCode(code, ((user as any).mfaRecoveryCodes as string[]) ?? []);
            if (!remaining) return null; // bad code → deny
            await db.update(users).set({ mfaRecoveryCodes: remaining }).where(eq(users.id, user.id));
          }
        }

        // Block login if the user has no organisation access.
        // Super admin is exempt (they can access any org).
        if (user.role !== "super_admin") {
          const memberships = await db
            .select({ id: userOrganisations.id })
            .from(userOrganisations)
            .where(eq(userOrganisations.userId, user.id))
            .limit(1);
          if (memberships.length === 0) {
            // No memberships — refuse login. Also deactivate so future attempts
            // fail fast without hitting the junction table.
            await db.update(users).set({ status: "Inactive" }).where(eq(users.id, user.id));
            return null;
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          orgId: user.orgId,
          repId: (user as any).repId ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.role = (user as any).role;
        token.orgId = (user as any).orgId;
        token.repId = (user as any).repId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).orgId = token.orgId;
        (session.user as any).repId = token.repId ?? null;
      }
      return session;
    },
  },
  events: {
    // Forensic trail of who logged in and when.
    async signIn({ user }) {
      const u = user as any;
      if (u?.id && u?.orgId) {
        await logEvent({ orgId: u.orgId, eventType: "user_login", actorId: u.id, actorName: u.email ?? null });
      }
    },
  },
});
