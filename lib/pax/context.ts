// Builds the tool context for one PAX Console message: the same McpContext the
// MCP endpoint builds, but for the SIGNED-IN user and with every power switched
// off except reading. callApi replays each call under that user's own role
// (lib/mcp/api-call.ts), which is what makes "depending on their rights" true.

import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logEvent } from "@/lib/audit";
import { callInternalApi } from "@/lib/mcp/api-call";
import { resolveLiveClaims } from "@/lib/mcp/auth";
import type { McpContext } from "@/lib/mcp/server";

export function paxToolContext(a: { requestUrl: string; userId: string; orgId: string }): McpContext {
  return {
    scopes: ["mcp:read"],
    connectionId: `pax:${a.userId}`,
    // Reads never mint a confirmation token; this only has to be a stable secret.
    confirmSecret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "",
    callApi: (c) => callInternalApi({ requestUrl: a.requestUrl, userId: a.userId, orgId: a.orgId, ...c }),
    // Not offered in this version (tools.ts); refused here as well.
    callQbo: async () => ({ ok: false, error: "The QuickBooks API is not available in PAX Console yet." }),
    // Fail closed: a read-only console has no business changing anything.
    aiSwitches: async () => ({ writes: false, deletes: false }),
    async whoami() {
      const claims = await resolveLiveClaims(a.userId, a.orgId);
      if (!claims) return { error: "Your access to this organisation has been removed or the account is inactive." };
      const [org] = await db.select({ name: organisations.name, displayName: organisations.displayName })
        .from(organisations).where(eq(organisations.id, a.orgId)).limit(1);
      return {
        user: { email: claims.email, name: claims.name },
        organisation: { id: a.orgId, name: org?.displayName || org?.name || null },
        role: claims.role,
        access: { read: true, write: false, delete: false },
        note: "Every call runs as this user, so the app's own role checks decide what succeeds. This version only reads.",
      };
    },
    async audit(e) {
      const claims = await resolveLiveClaims(a.userId, a.orgId);
      await logEvent({
        orgId: a.orgId,
        eventType: e.method === "DELETE" ? "mcp_delete" : e.method === "GET" ? "mcp_read" : "mcp_write",
        actorId: a.userId,
        actorName: claims?.email ?? null,
        meta: { via: "pax_console", method: e.method, path: e.path, status: e.status, ref: e.ref ?? null },
      });
    },
  };
}
