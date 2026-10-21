import { describe, it, expect } from "vitest";
import {
  isOciReserve, isOtherReserve, isEquityDistribution, isShareCapital, isRetainedEarningsAccount, isProvision, equityCategory,
} from "@/lib/accounting/ifrs";
import { ACCOUNT_TYPES } from "@/lib/accounting/account-types";

describe("lib/accounting/ifrs.ts — pure IFRS presentation classifiers", () => {
  it("recognizes the three OCI reserve subtypes, case/space-insensitively", () => {
    expect(isOciReserve("Revaluation Surplus")).toBe(true);
    expect(isOciReserve("  revaluation surplus  ")).toBe(true);
    expect(isOciReserve("REVALUATION SURPLUS")).toBe(true);
    expect(isOciReserve("Foreign Currency Translation Reserve")).toBe(true);
    expect(isOciReserve("Fair Value Reserve")).toBe(true);
    expect(isOciReserve("General Reserve")).toBe(false); // appropriation, not OCI
    expect(isOciReserve("Retained Earnings")).toBe(false);
    expect(isOciReserve(null)).toBe(false);
  });

  it("General Reserve is its own category, never counted as OCI", () => {
    expect(isOtherReserve("General Reserve")).toBe(true);
    expect(isOtherReserve("Revaluation Surplus")).toBe(false);
  });

  it("recognizes equity distributions (drawings, partner distributions, dividends)", () => {
    expect(isEquityDistribution("Owner's Drawings")).toBe(true);
    expect(isEquityDistribution("Partner Distributions")).toBe(true);
    expect(isEquityDistribution("Dividends Paid")).toBe(true);
    expect(isEquityDistribution("Share Capital")).toBe(false);
  });

  it("recognizes share-capital subtypes including the new Share Premium", () => {
    expect(isShareCapital("Share Capital")).toBe(true);
    expect(isShareCapital("Share Premium")).toBe(true);
    expect(isShareCapital("Partner Contributions")).toBe(true);
    expect(isShareCapital("Retained Earnings")).toBe(false);
  });

  it("recognizes retained earnings and opening balance equity", () => {
    expect(isRetainedEarningsAccount("Retained Earnings")).toBe(true);
    expect(isRetainedEarningsAccount("Opening Balance Equity")).toBe(true);
    expect(isRetainedEarningsAccount("Share Capital")).toBe(false);
  });

  it("recognizes the Provisions subtype (IAS 37)", () => {
    expect(isProvision("Provisions")).toBe(true);
    expect(isProvision("Accrued Liabilities")).toBe(false);
    expect(isProvision(null)).toBe(false);
  });

  it("equityCategory() categorizes every known equity subtype, with a safe default", () => {
    expect(equityCategory("Share Capital")).toBe("shareCapital");
    expect(equityCategory("Share Premium")).toBe("shareCapital");
    expect(equityCategory("Retained Earnings")).toBe("retainedEarnings");
    expect(equityCategory("Opening Balance Equity")).toBe("retainedEarnings");
    expect(equityCategory("Revaluation Surplus")).toBe("otherReserves");
    expect(equityCategory("General Reserve")).toBe("otherReserves");
    expect(equityCategory("Owner's Drawings")).toBe("distributions");
    expect(equityCategory(null)).toBe("shareCapital"); // every account must land somewhere
    expect(equityCategory("Some Future Custom Subtype")).toBe("shareCapital");
  });

  it("every new IFRS subtype is actually registered on the Equity/liability types in account-types.ts, or this classifier is dead code", () => {
    const equitySubtypes = ACCOUNT_TYPES.find((t) => t.type === "Equity")!.subtypes;
    for (const s of ["Share Premium", "Revaluation Surplus", "Foreign Currency Translation Reserve", "Fair Value Reserve", "General Reserve", "Dividends Paid"]) {
      expect(equitySubtypes).toContain(s);
    }
    const ltlSubtypes = ACCOUNT_TYPES.find((t) => t.type === "Long Term Liability")!.subtypes;
    const oclSubtypes = ACCOUNT_TYPES.find((t) => t.type === "Other Current Liability")!.subtypes;
    expect(ltlSubtypes).toContain("Provisions");
    expect(oclSubtypes).toContain("Provisions");
  });
});
