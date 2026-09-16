/**
 * Which hosts may appear in a link we email to a CUSTOMER.
 *
 * Reported live: the customer portal was sending people to the Vercel login
 * page. Verified against production:
 *   primeaccountax.com/portal/<token>        -> 200
 *   ledger-<hash>.vercel.app/portal/<token>  -> redirect to vercel.com/sso-api
 *
 * Deployment URLs sit behind Vercel Deployment Protection. getAppUrl() took the
 * live request host first, so any link generated while the app was served on a
 * deployment URL went out pointing at a login wall — and nothing about that is
 * visible at send time.
 */
import { describe, it, expect } from "vitest";
import { isPublicHost } from "@/lib/portal";

describe("isPublicHost", () => {
  it("accepts the real customer-facing domain", () => {
    expect(isPublicHost("primeaccountax.com")).toBe(true);
    expect(isPublicHost("www.primeaccountax.com")).toBe(true);
    expect(isPublicHost("acme.primeaccountax.com")).toBe(true); // white-label subdomain
  });

  it("REJECTS a Vercel deployment host — the actual bug", () => {
    expect(isPublicHost("ledger-9u0qhupmc-wajahatkhan786-9846s-projects.vercel.app")).toBe(false);
    expect(isPublicHost("anything.vercel.app")).toBe(false);
    expect(isPublicHost("vercel.app")).toBe(false);
  });

  it("is case-insensitive — a Host header is not guaranteed lowercase", () => {
    expect(isPublicHost("Ledger-ABC.VERCEL.APP")).toBe(false);
    expect(isPublicHost("PrimeAccountax.com")).toBe(true);
  });

  it("rejects localhost and loopback, so a dev machine can't email a dead link", () => {
    for (const h of ["localhost", "localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
      expect(isPublicHost(h)).toBe(false);
    }
  });

  it("rejects a missing host rather than building a link from nothing", () => {
    expect(isPublicHost(null)).toBe(false);
    expect(isPublicHost(undefined)).toBe(false);
    expect(isPublicHost("")).toBe(false);
  });

  it("does not reject a domain that merely CONTAINS the word vercel", () => {
    // Suffix match, not substring: a customer could legitimately be called this.
    expect(isPublicHost("vercelconsulting.com")).toBe(true);
    expect(isPublicHost("my-vercel-app.com")).toBe(true);
  });
});
