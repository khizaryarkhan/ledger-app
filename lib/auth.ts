import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { logEvent } from "@/lib/audit";
import { verifyCredentials } from "@/lib/credentials";
import { db } from "@/db";
import { users, userOrganisations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import {
  verifyTicket, startImpersonation, stopImpersonation, isExpired, type Identity,
} from "@/lib/impersonation";

/**
 * After "Sign in as" ends, the restored identity's role is re-read: an admin
 * demoted or deactivated during the hour must not get a stale super_admin back.
 */
async function withCurrentRole(tok: Record<string, any>): Promise<Record<string, any>> {
  if (!tok?.id) return tok;
  try {
    const [u] = await db.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, tok.id)).limit(1);
    if (!u || u.status !== "Active") return { ...tok, role: "inactive" };
    return { ...tok, role: u.role };
  } catch { return tok; }
}

/** The account to sign in as: active, a member of the ticket's org, never an admin of the platform. */
async function impersonationTarget(userId: string, orgId: string): Promise<Identity | null> {
  const [row] = await db.select({
    id: users.id, name: users.name, email: users.email, repId: users.repId, status: users.status,
    globalRole: users.role, role: userOrganisations.role,
  }).from(users)
    .innerJoin(userOrganisations, and(eq(userOrganisations.userId, users.id), eq(userOrganisations.orgId, orgId)))
    .where(eq(users.id, userId)).limit(1);
  if (!row || row.status !== "Active") return null;
  if (row.globalRole === "super_admin" || row.globalRole === "platform_admin") return null;
  return { id: row.id, role: row.role, orgId, repId: row.repId ?? null, name: row.name, email: row.email };
}

const isProd = process.env.VERCEL_ENV === "production";

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // 8 hours — re-login required after inactivity
  pages: { signIn: "/login" },
  cookies: isProd ? {
    sessionToken: {
      name: "__Secure-next-auth.session-token",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: true, domain: ".primeaccountax.com" },
    },
  } : undefined,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        mfaCode: { label: "Authentication code", type: "text" },
      },
      async authorize(credentials) {
        return verifyCredentials({
          email: credentials?.email as string | undefined,
          password: credentials?.password as string | undefined,
          mfaCode: credentials?.mfaCode as string | undefined,
        });
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = (user as any).id;
        token.role = (user as any).role;
        token.orgId = (user as any).orgId;
        token.repId = (user as any).repId ?? null;
      }
      // "Sign in as" (lib/impersonation.ts). Start needs a server-minted ticket;
      // stop needs nothing, because it can only ever return to the original.
      if (trigger === "update" && (session as any)?.stopImpersonation) {
        return await withCurrentRole(stopImpersonation(token as any)) as any;
      }
      if (trigger === "update" && (session as any)?.impersonationTicket) {
        const ticket = verifyTicket((session as any).impersonationTicket);
        const target = ticket ? await impersonationTarget(ticket.as, ticket.orgId) : null;
        return startImpersonation(token as any, ticket, target) as any;
      }
      if (isExpired(token as any)) return await withCurrentRole(stopImpersonation(token as any)) as any;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).orgId = token.orgId;
        (session.user as any).repId = token.repId ?? null;
        session.user.name = (token.name as string) ?? session.user.name;
        session.user.email = (token.email as string) ?? session.user.email;
        const imp = (token as any).imp;
        (session.user as any).impersonatedBy = imp ? { name: imp.original?.name ?? null, email: imp.original?.email ?? null, until: imp.until } : null;
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
