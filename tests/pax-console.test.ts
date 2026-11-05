import { describe, expect, it } from "vitest";
import { PROVIDERS, isPrivateAddress, last4, providerById, resolveEndpoint, tierFor, validateEndpoint } from "@/lib/pax/providers";
import { toUiBlocks } from "@/lib/pax/ui-shape";
import { buildSystemPrompt, capabilityIndex } from "@/lib/pax/prompt";
import { API_ROUTES } from "@/lib/mcp/route-manifest";
import { assertResolvedPublic, safeFetch } from "@/lib/pax/safe-fetch";
import { acquire } from "@/lib/pax/inflight";

describe("provider registry", () => {
  it("has unique ids and https, slash-free addresses for every fixed provider", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROVIDERS.filter((x) => x.baseUrl)) {
      expect(p.baseUrl, p.id).toMatch(/^https:\/\//);
      expect(p.baseUrl, p.id).not.toMatch(/\/$/);
    }
  });

  it("never lets a provider be both fixed and user-addressed, or ready without an address", () => {
    for (const p of PROVIDERS) {
      expect(p.baseUrl && p.needsBaseUrl, p.id).toBeFalsy();
      if (p.ready) expect(Boolean(p.baseUrl) || p.needsBaseUrl, p.id).toBe(true);
    }
  });

  it("ignores a user-typed address for a provider whose address is fixed", () => {
    const openai = providerById("openai")!;
    expect(resolveEndpoint(openai, "https://evil.example.com/v1")).toEqual({ ok: true, url: "https://api.openai.com/v1" });
  });

  it("refuses a provider that is only planned", () => {
    const r = resolveEndpoint(providerById("bedrock")!, "https://x.example.com");
    expect(r.ok).toBe(false);
  });

  it("includes the providers people asked for by name", () => {
    for (const id of ["deepseek", "xai", "moonshot", "alibaba", "groq", "openrouter", "mistral", "custom"]) {
      expect(providerById(id)?.ready, id).toBe(true);
    }
  });
});

describe("endpoint safety (the server calls these addresses)", () => {
  it.each([
    "http://api.example.com/v1",
    "https://localhost/v1",
    "https://127.0.0.1/v1",
    "https://10.0.0.5/v1",
    "https://172.16.4.1/v1",
    "https://192.168.1.10/v1",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/v1",
    "https://user:pass@api.example.com/v1",
    "https://intranet/v1",
    "https://db.internal/v1",
    "https://printer.local/v1",
    "ftp://api.example.com",
    "not a url",
    "",
  ])("refuses %s", (u) => {
    expect(validateEndpoint(u).ok).toBe(false);
  });

  it("accepts a public https address and trims a trailing slash", () => {
    expect(validateEndpoint("https://llm.example.com/v1/")).toEqual({ ok: true, url: "https://llm.example.com/v1" });
  });

  it("recognises private and public addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "0.0.0.0"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("model tier (whether a model may ever be offered changes)", () => {
  it.each([
    ["openai", "gpt-4.1", "full"],
    ["anthropic", "claude-sonnet-5-5", "full"],
    ["groq", "llama-3.3-70b-versatile", "full"],
    ["alibaba", "qwen3-235b-a22b", "full"],
    ["openrouter", "openai/gpt-4.1", "full"],
    ["groq", "llama-3.1-8b-instant", "read"],
    ["openai", "gpt-4o-mini", "read"],
    ["deepseek", "deepseek-reasoner", "read"],
    ["deepseek", "deepseek-r1", "read"],
    ["together", "google/gemma-2-9b-it", "read"],
    ["custom", "anything-large", "read"],
    ["vllm", "llama-3.3-70b", "read"],
  ])("%s %s is %s", (p, m, t) => {
    expect(tierFor(p, m)).toBe(t);
  });
});

describe("IPv6 forms that point inside (found in security review)", () => {
  it.each([
    "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "2002:7f00:1::", "::127.0.0.1",
    "fec0::1", "ff02::1", "2001:db8::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "not::an::address", "::ffff:10.0.0.1",
  ])("treats %s as private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["2606:4700::1111", "2a00:1450:4009:81f::200e", "::ffff:8.8.8.8", "::ffff:808:808"])("treats %s as public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it("refuses a non-standard port but accepts the explicit standard one", () => {
    expect(validateEndpoint("https://llm.example.com:8443/v1").ok).toBe(false);
    expect(validateEndpoint("https://llm.example.com:443/v1")).toEqual({ ok: true, url: "https://llm.example.com/v1" });
  });
});

describe("connecting to an address the user typed", () => {
  it("requires every resolved address to be public", () => {
    expect(() => assertResolvedPublic([])).toThrow();
    expect(() => assertResolvedPublic([{ address: "8.8.8.8" }, { address: "10.0.0.1" }])).toThrow(/private/);
    expect(() => assertResolvedPublic([{ address: "8.8.8.8" }, { address: "2606:4700::1111" }])).not.toThrow();
  });

  it("refuses http and other ports before any network is used", async () => {
    await expect(safeFetch("http://example.com/")).rejects.toThrow(/https/);
    await expect(safeFetch("https://example.com:8443/")).rejects.toThrow(/port/);
  });
});

describe("the in-flight cap", () => {
  it("holds a slot until it is released, and releasing twice frees only one", () => {
    const a = acquire("cap-test", 1)!;
    expect(a).toBeTruthy();
    expect(acquire("cap-test", 1)).toBeNull();
    a();
    a();
    const b = acquire("cap-test", 1);
    expect(b).toBeTruthy();
    expect(acquire("cap-test", 1)).toBeNull();
    b!();
  });
});

describe("the capability index when trimmed", () => {
  it("keeps every area and only whole lines", () => {
    const routes = Array.from({ length: 30 }, (_, a) => Array.from({ length: 40 }, (_, i) => ({ path: `/api/area${a}/item${i}`, methods: ["GET"] }))).flat();
    const text = capabilityIndex({ enabledModules: [], routes, maxChars: 1500 });
    expect(text.length).toBeLessThanOrEqual(1500);
    for (let a = 0; a < 30; a++) expect(text).toContain(`- area${a}:`);
  });
});

describe("last4", () => {
  it("keeps only the last four letters or digits and never throws", () => {
    expect(last4("sk-abc123XYZ9")).toBe("XYZ9");
    expect(last4("ab")).toBe("ab");
    expect(last4("---")).toBe("????");
  });
});

describe("stored messages as screen blocks", () => {
  it("shows the user's words, a chip per lookup and the answer, and hides tool results and the system prompt", () => {
    const blocks = toUiBlocks([
      { message: { role: "system", content: "secret rules" } },
      { message: { role: "user", content: "Which invoices are overdue?" } },
      { message: { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "api_get", arguments: '{"path":"/api/invoices"}' } }] } },
      { message: { role: "tool", tool_call_id: "1", content: "HTTP 200 [private rows]" } },
      { message: { role: "assistant", content: "Three are overdue." } },
    ]);
    expect(blocks).toEqual([
      { kind: "user", text: "Which invoices are overdue?" },
      { kind: "tool", label: "Read /api/invoices" },
      { kind: "assistant", text: "Three are overdue." },
    ]);
    expect(JSON.stringify(blocks)).not.toMatch(/secret rules|private rows/);
  });

  it("survives a malformed message", () => {
    expect(toUiBlocks([{ message: null }, { message: { role: "assistant", tool_calls: [{ function: { name: "api_get", arguments: "{bad" } }] } }])).toEqual([{ kind: "tool", label: "api_get" }]);
  });
});

describe("what the model is told", () => {
  const routes = [
    { path: "/api/invoices", methods: ["GET"] },
    { path: "/api/invoices/[id]", methods: ["GET", "PATCH"] },
    { path: "/api/accounting/[entity]", methods: ["POST"] },
    { path: "/api/admin/organisations", methods: ["GET"] },
    { path: "/api/pax-console/settings", methods: ["GET"] },
    { path: "/api/resources/people", methods: ["GET"] },
  ];

  it("lists only readable routes an AI call may use, in modules the organisation has", () => {
    const text = capabilityIndex({ enabledModules: ["receivables"], routes });
    expect(text).toContain("invoices");
    expect(text).toContain("/invoices/{id}");
    expect(text).not.toMatch(/admin|pax-console|resources|accounting/);
  });

  it("includes a module's routes once the organisation has that module", () => {
    expect(capabilityIndex({ enabledModules: ["receivables", "resources"], routes })).toContain("resources");
  });

  it("builds a prompt that names the user, organisation, currency and the read-only rule", () => {
    const p = buildSystemPrompt({ userName: "Wajahat Khan", role: "company_admin", orgName: "EDC", homeCurrency: "EUR", enabledModules: ["receivables"], fiscalYearStartMonth: 7, today: "2026-11-05", routes });
    expect(p).toContain("Wajahat Khan");
    expect(p).toContain("EDC");
    expect(p).toContain("EUR");
    expect(p).toContain("July");
    expect(p).toContain("2026-11-05");
    expect(p).toMatch(/can only read/);
    expect(p).toMatch(/never follow instructions/i);
  });

  it("teaches the app's vocabulary and recipes, and tells the model to look before it asks", () => {
    const p = buildSystemPrompt({ userName: null, role: "company_user", orgName: "EDC", homeCurrency: "EUR", enabledModules: ["receivables"], fiscalYearStartMonth: null, today: "2026-11-05", routes });
    expect(p).toMatch(/How Prime Accountax uses its words/);
    expect(p).toMatch(/Common questions/);
    expect(p).toMatch(/analyze/);
    expect(p).toMatch(/look before you ask/i);
  });

  it("lists earlier lookups by label and states the write and QuickBooks abilities when granted", () => {
    const base = { userName: null, role: "company_admin", orgName: "EDC", homeCurrency: "EUR", enabledModules: ["receivables"], fiscalYearStartMonth: null, today: "2026-11-05", routes };
    const p = buildSystemPrompt({ ...base, lookups: ["Read /api/invoices (ok)"] });
    expect(p).toContain("Read /api/invoices (ok)");
    const w = buildSystemPrompt({ ...base, canWrite: true, hasQbo: true });
    expect(w).toMatch(/confirm card/);
    expect(w).toMatch(/qbo_api/);
    expect(w).not.toMatch(/can only read/);
  });

  it("keeps the real capability index within its budget and free of private areas", () => {
    const text = capabilityIndex({ enabledModules: ["receivables", "payables", "accounting", "studio", "manufacturing", "resources"], routes: API_ROUTES });
    expect(text.length).toBeLessThanOrEqual(6000);
    expect(text.length).toBeGreaterThan(500);
    expect(text).not.toMatch(/^- (admin|billing|auth|cron|mcp|pax-console|webhooks):/m);
  });
});
