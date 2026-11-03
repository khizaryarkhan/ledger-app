import { describe, it, expect } from "vitest";
import { scanApiRoutes } from "@/scripts/gen-mcp-manifest";
import { API_ROUTES } from "@/lib/mcp/route-manifest";
import { checkApiPath } from "@/lib/mcp/policy";

const sample = (p: string) => p.replace(/\[\.\.\.[^\]]+\]|\[[^\]]+\]/g, "x");

describe("MCP route manifest", () => {
  it("lists exactly the routes under app/api (run `npm run mcp:manifest` if this fails)", () => {
    expect(API_ROUTES.map((r) => ({ path: r.path, methods: [...r.methods] }))).toEqual(scanApiRoutes());
  });

  it("offers an AI connection no route that carries credentials, identity, billing or a hand-shake", () => {
    // Guards the deny-list from the other side: a NEW route with one of these
    // words in its path must either be blocked by policy.ts or this test names it.
    const SENSITIVE = /(^|\/)(admin|auth|billing|cron|webhooks?|inngest|smtp|callback|connect|disconnect|reset-password|forgot-password|mfa|register|mobile)(\/|$)/;
    const reachable = API_ROUTES.filter((r) => checkApiPath(sample(r.path)).ok && SENSITIVE.test(r.path)).map((r) => r.path);
    expect(reachable).toEqual([]);
  });

  it("never offers the MCP server's own routes", () => {
    const own = API_ROUTES.filter((r) => r.path.startsWith("/api/mcp") && checkApiPath(sample(r.path)).ok);
    expect(own).toEqual([]);
  });
});
