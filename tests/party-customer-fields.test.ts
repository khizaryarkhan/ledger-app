import { describe, it, expect } from "vitest";
import { customerExtras } from "@/lib/party-customer-fields";

const ID = "3f2b8c1e-5a47-4d0e-9a6b-1c2d3e4f5a6b";

describe("customerExtras", () => {
  it("returns nothing for a body with none of the customer fields (PATCH leaves columns alone)", () => {
    expect(customerExtras({ name: "Acme" })).toEqual({ values: {} });
    expect(customerExtras(undefined)).toEqual({ values: {} });
  });

  it("accepts every status a customer can have, including On Hold", () => {
    for (const status of ["Active", "On Hold", "Inactive"]) {
      expect(customerExtras({ status })).toEqual({ values: { status } });
    }
  });

  it("rejects an unknown status or risk rating rather than storing it", () => {
    expect(customerExtras({ status: "Dormant" })).toHaveProperty("error");
    expect(customerExtras({ riskRating: "Extreme" })).toHaveProperty("error");
  });

  it("treats a blank credit limit as none, and refuses a negative or non-numeric one", () => {
    expect(customerExtras({ creditLimit: "" })).toEqual({ values: { creditLimit: null } });
    expect(customerExtras({ creditLimit: "250000" })).toEqual({ values: { creditLimit: 250000 } });
    expect(customerExtras({ creditLimit: "-1" })).toHaveProperty("error");
    expect(customerExtras({ creditLimit: "lots" })).toHaveProperty("error");
  });

  it("keeps a country id, clears a blank one, and refuses a malformed one", () => {
    expect(customerExtras({ countryId: ID })).toEqual({ values: { countryId: ID } });
    expect(customerExtras({ countryId: "" })).toEqual({ values: { countryId: null } });
    expect(customerExtras({ countryId: "Ireland" })).toHaveProperty("error");
  });

  it("trims and bounds the payment method", () => {
    expect(customerExtras({ paymentMethod: "  Cheque " })).toEqual({ values: { paymentMethod: "Cheque" } });
    expect(customerExtras({ paymentMethod: "" })).toEqual({ values: { paymentMethod: null } });
  });
});
