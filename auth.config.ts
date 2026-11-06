/**
 * Edge-safe NextAuth config — used ONLY by middleware.ts.
 * No Node.js imports (no bcrypt, no DB, no crypto).
 * The full auth config (lib/auth.ts) handles login and session writes.
 */
import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";

const isProd = process.env.VERCEL_ENV === "production";

const config: NextAuthConfig = {
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  // Share the session cookie across all subdomains (e.g. admin.primeaccountax.com)
  cookies: isProd ? {
    sessionToken: {
      name: "__Secure-next-auth.session-token",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: true, domain: ".primeaccountax.com" },
    },
  } : undefined,
  providers: [], // credentials can't run in Edge — login goes through /api/auth directly
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.role = (user as any).role;
        token.orgId = (user as any).orgId;
        token.repId = (user as any).repId ?? null;
      }
      // "Sign in as" ends by itself; lib/impersonation.ts can't be imported
      // here (Node crypto), so the restore is repeated inline: put the original back.
      const imp = (token as any).imp;
      if (imp?.original && typeof imp.until === "number" && imp.until < Date.now()) {
        const { imp: _gone, ...rest } = token as any;
        return { ...rest, ...imp.original };
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).orgId = token.orgId;
        (session.user as any).repId = token.repId ?? null;
        const imp = (token as any).imp;
        (session.user as any).impersonatedBy = imp ? { name: imp.original?.name ?? null, until: imp.until } : null;
      }
      return session;
    },
  },
};

export const { auth } = NextAuth(config);
