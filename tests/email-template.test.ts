import { describe, it, expect } from "vitest";
import { fillTemplate, greetingName } from "@/lib/email-template";

describe("fillTemplate", () => {
  it("substitutes the documented vocabulary, case-insensitively", () => {
    expect(fillTemplate("Hi {name}, ref {REF}", { name: "Sam", ref: "AB12" }))
      .toBe("Hi Sam, ref AB12");
  });

  it("accepts {invoice lines} with a space, as templates in the wild use it", () => {
    expect(fillTemplate("{invoicelines}|{invoice lines}", { name: "x", ref: "r", invoiceLines: ["#1"] }))
      .toBe("#1|#1");
  });

  it("resolves {invoicelines} to empty when none are supplied", () => {
    // The branded table already lists the invoices; filling this would double them.
    expect(fillTemplate("A{invoicelines}B", { name: "x", ref: "r" })).toBe("AB");
  });

  it("leaves a template with no placeholders untouched", () => {
    expect(fillTemplate("Plain text", { name: "Sam", ref: "AB12" })).toBe("Plain text");
  });

  it("does not leave a literal {name} in the output — the reported bug", () => {
    const out = fillTemplate("Hi{name}", { name: greetingName("Nada Maher"), ref: "R1" });
    expect(out).toBe("HiNada");
    expect(out).not.toContain("{name}");
  });
});

describe("greetingName", () => {
  it("takes the first name", () => {
    expect(greetingName("Umair Abdul Basit")).toBe("Umair");
  });
  it("falls back to a neutral greeting rather than an empty space", () => {
    expect(greetingName(null)).toBe("there");
    expect(greetingName("")).toBe("there");
    expect(greetingName("   ")).toBe("there");
  });
});
