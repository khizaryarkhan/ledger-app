import { describe, it, expect } from "vitest";
import { latestBandContact } from "@/lib/board-contact";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const daysBefore = (n: number) => new Date(NOW - n * 86400000).toISOString();

describe("Last Email Ref on a customer / project band", () => {
  it("an email sent today wins over a chase logged 108 days ago (the reported bug)", () => {
    const r = latestBandContact({
      invoices: [{ lastSent: daysBefore(0), lastRef: "AR-261109-EVK3" }],
      entityChase: { at: daysBefore(108), label: "Chase" },
    }, NOW);
    expect(r?.days).toBe(0);
    expect(r?.ref).toBe("AR-261109-EVK3");
    expect(r?.activityType).toBe("Email");
  });

  it("agrees with the newest invoice inside it", () => {
    const r = latestBandContact({
      invoices: [
        { lastSent: daysBefore(40), lastRef: "OLD" },
        { lastSent: daysBefore(3), lastRef: "NEW" },
        { lastSent: null, lastRef: null },
      ],
    }, NOW);
    expect(r).toMatchObject({ days: 3, ref: "NEW" });
  });

  it("a newer chase logged on the band still counts", () => {
    const r = latestBandContact({
      invoices: [{ lastSent: daysBefore(20), lastRef: "X" }],
      entityChase: { at: daysBefore(2), label: "Call" },
    }, NOW);
    expect(r).toMatchObject({ days: 2, activityType: "Call", ref: null });
  });

  it("an invoice-level logged chase counts", () => {
    const r = latestBandContact({ invoices: [{ lastSent: daysBefore(9), lastRef: "X", chaseMs: NOW - 86400000 }] }, NOW);
    expect(r).toMatchObject({ days: 1, activityType: "Chase" });
  });

  it("nothing sent and nothing logged reads as never", () => {
    expect(latestBandContact({ invoices: [{ lastSent: null, lastRef: null }] }, NOW)).toBeNull();
  });
});
