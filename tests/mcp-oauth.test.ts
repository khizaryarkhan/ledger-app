import { describe, it, expect } from "vitest";
import {
  normaliseScopes, isValidRedirectUri, redirectUriMatches, pkceChallengeFor, verifyPkceS256,
  sha256Hex, randomToken, TOKEN_PREFIX, makeConfirmToken, verifyConfirmToken, stableStringify,
} from "@/lib/mcp/oauth";

describe("normaliseScopes", () => {
  it("always grants read, even when nothing is asked", () => {
    expect(normaliseScopes("")).toEqual(["mcp:read"]);
    expect(normaliseScopes(null)).toEqual(["mcp:read"]);
  });
  it("never implies write or delete from anything else", () => {
    expect(normaliseScopes("mcp:read")).toEqual(["mcp:read"]);
    expect(normaliseScopes("admin superuser")).toEqual(["mcp:read"]);
  });
  it("accepts space, comma and array forms, drops unknown scopes", () => {
    expect(normaliseScopes("mcp:write mcp:delete")).toEqual(["mcp:read", "mcp:write", "mcp:delete"]);
    expect(normaliseScopes("mcp:delete,bogus")).toEqual(["mcp:read", "mcp:delete"]);
    expect(normaliseScopes(["mcp:write"])).toEqual(["mcp:read", "mcp:write"]);
  });
});

describe("PKCE", () => {
  const verifier = "a".repeat(43) + "-._~";
  it("accepts the matching S256 challenge", () => {
    expect(verifyPkceS256(verifier, pkceChallengeFor(verifier))).toBe(true);
  });
  it("rejects a different verifier", () => {
    expect(verifyPkceS256("b".repeat(50), pkceChallengeFor(verifier))).toBe(false);
  });
  it("rejects a verifier outside RFC 7636 length/charset", () => {
    expect(verifyPkceS256("short", pkceChallengeFor("short"))).toBe(false);
    expect(verifyPkceS256("a".repeat(129), pkceChallengeFor("a".repeat(129)))).toBe(false);
    expect(verifyPkceS256("a".repeat(42) + "!", pkceChallengeFor("a".repeat(42) + "!"))).toBe(false);
  });
  it("rejects when the challenge was the plain verifier (plain method is not supported)", () => {
    expect(verifyPkceS256(verifier, verifier)).toBe(false);
  });
});

describe("isValidRedirectUri", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "http://localhost:3000/callback",
    "http://127.0.0.1:8123/cb",
    "http://[::1]:9/cb",
    "cursor://anysphere.cursor-deeplink/mcp/auth",
  ])("accepts %s", (u) => expect(isValidRedirectUri(u)).toBe(true));

  it.each([
    "ms-msdt:/id PCWDiagnostic",         // OS protocol handlers are not redirect targets
    "search-ms:query=x&crumb=location:\\\\evil",
    "myapp://callback",                  // an app scheme that is not on the allowlist
    "http://evil.example/cb",            // cleartext, not loopback
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "file:///etc/passwd",
    "https://claude.ai/cb#frag",         // fragment forbidden
    "https://user:pw@claude.ai/cb",      // credentials in URL
    "not a url",
    "",
  ])("rejects %s", (u) => expect(isValidRedirectUri(u)).toBe(false));

  it("rejects non-strings and oversize input", () => {
    expect(isValidRedirectUri(undefined)).toBe(false);
    expect(isValidRedirectUri(42)).toBe(false);
    expect(isValidRedirectUri("https://a.example/" + "x".repeat(2000))).toBe(false);
  });
});

describe("redirectUriMatches", () => {
  it("requires an exact match for non-loopback URLs", () => {
    const reg = ["https://claude.ai/cb"];
    expect(redirectUriMatches(reg, "https://claude.ai/cb")).toBe(true);
    expect(redirectUriMatches(reg, "https://claude.ai/cb2")).toBe(false);
    expect(redirectUriMatches(reg, "https://claude.ai/cb?x=1")).toBe(false);
    expect(redirectUriMatches(reg, "https://evil.example/cb")).toBe(false);
  });
  it("lets a loopback URL differ in port only", () => {
    const reg = ["http://localhost:3000/cb"];
    expect(redirectUriMatches(reg, "http://localhost:54321/cb")).toBe(true);
    expect(redirectUriMatches(reg, "http://localhost:54321/other")).toBe(false);
    expect(redirectUriMatches(reg, "http://127.0.0.1:3000/cb")).toBe(false);
  });
  it("never widens a non-loopback http registration", () => {
    expect(redirectUriMatches(["https://a.example/cb"], "http://a.example/cb")).toBe(false);
  });
});

describe("sensitive scope", () => {
  it("is never granted unless asked for explicitly", () => {
    expect(normaliseScopes("mcp:read mcp:write mcp:delete")).not.toContain("mcp:sensitive");
    expect(normaliseScopes("mcp:sensitive")).toEqual(["mcp:read", "mcp:sensitive"]);
  });
});

describe("confirmation tokens", () => {
  const now = 1_800_000_000_000;
  const bind = stableStringify(["conn", "DELETE", "/api/x/1", null, null]);
  it("verifies for the same binding within the window", () => {
    const t = makeConfirmToken("k", bind, now);
    expect(verifyConfirmToken("k", bind, t, now + 60_000)).toBe(true);
  });
  it("expires after five minutes", () => {
    const t = makeConfirmToken("k", bind, now);
    expect(verifyConfirmToken("k", bind, t, now + 6 * 60_000)).toBe(false);
  });
  it("fails for another binding or another secret", () => {
    const t = makeConfirmToken("k", bind, now);
    expect(verifyConfirmToken("k", stableStringify(["conn", "DELETE", "/api/x/2", null, null]), t, now)).toBe(false);
    expect(verifyConfirmToken("other", bind, t, now)).toBe(false);
  });
  it("rejects a forged expiry far in the future, and non-strings", () => {
    const [, mac] = makeConfirmToken("k", bind, now).split(".");
    expect(verifyConfirmToken("k", bind, `${Math.floor(now / 1000) + 86400}.${mac}`, now)).toBe(false);
    for (const bad of [true, undefined, null, 5, "", "a.b", "x".repeat(300)]) expect(verifyConfirmToken("k", bind, bad, now)).toBe(false);
  });
  it("stableStringify ignores key order but not content", () => {
    expect(stableStringify({ a: 1, b: { d: 2, c: 3 } })).toBe(stableStringify({ b: { c: 3, d: 2 }, a: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});

describe("tokens", () => {
  it("hashes deterministically and never stores the token itself", () => {
    const t = randomToken(TOKEN_PREFIX.access);
    expect(t.startsWith("pat_")).toBe(true);
    expect(sha256Hex(t)).toBe(sha256Hex(t));
    expect(sha256Hex(t)).not.toContain(t);
    expect(sha256Hex(t)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("generates distinct tokens", () => {
    expect(randomToken("x_")).not.toBe(randomToken("x_"));
  });
});
