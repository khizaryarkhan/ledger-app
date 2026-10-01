import { describe, it, expect } from "vitest";
import { fillTemplate, greetingName, buildTemplateMaps, pickTemplate } from "@/lib/email-template";
import type { EmailTemplate } from "@/db/schema";

const tpl = (over: Partial<EmailTemplate> = {}): EmailTemplate => ({
  id: "t1",
  orgId: "org1",
  name: "Test template",
  subject: "Subject",
  body: "Body",
  collectionStage: null,
  escalationType: null,
  isActive: true,
  isDefault: false,
  sendIntervalDays: 7,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...over,
} as EmailTemplate);

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
  it("falls back to Sir/Madam — matching the daily chase, legacy cron, and manual trigger paths, which was the majority tone before this consolidated", () => {
    expect(greetingName(null)).toBe("Sir/Madam");
    expect(greetingName("")).toBe("Sir/Madam");
    expect(greetingName("   ")).toBe("Sir/Madam");
  });
});

describe("fillTemplate — the composer's vocabulary also resolves here", () => {
  it("substitutes {contactName} and {customerName} as aliases of {name}/customerName", () => {
    expect(fillTemplate("Hi {contactName} from {customerName}", { name: "Sam", customerName: "Acme Ltd" }))
      .toBe("Hi Sam from Acme Ltd");
  });

  it("falls back name<->customerName when only one is supplied, rather than leaving the other blank", () => {
    expect(fillTemplate("{name}/{customerName}", { name: "Sam" })).toBe("Sam/Sam");
    expect(fillTemplate("{name}/{customerName}", { customerName: "Acme Ltd" })).toBe("Acme Ltd/Acme Ltd");
  });

  it("substitutes {referenceNumber}/{invoiceNumber}/{amount}/{dueDate}/{daysOverdue}/{senderName}", () => {
    const out = fillTemplate(
      "{referenceNumber} {invoiceNumber} {amount} {dueDate} {daysOverdue} {senderName}",
      { ref: "R1", invoiceNumber: "INV-1", amount: "$70.00", dueDate: "04 Sep 2026", daysOverdue: "3", senderName: "Jo" },
    );
    expect(out).toBe("R1 INV-1 $70.00 04 Sep 2026 3 Jo");
  });
});

describe("pickTemplate — escalation-type-specific vs generic stage matching", () => {
  it("an exact (stage, escalationType) match wins over the generic stage template", () => {
    const generic = tpl({ id: "generic", collectionStage: "Escalated", escalationType: null });
    const legal = tpl({ id: "legal", collectionStage: "Escalated", escalationType: "Legal" });
    const { byStage, byStageAndType } = buildTemplateMaps([generic, legal]);

    const picked = pickTemplate(byStageAndType, byStage, "Escalated", "Legal");

    expect(picked?.id).toBe("legal");
  });

  it("falls back to the generic stage template when the invoice's escalationType has no dedicated template", () => {
    const generic = tpl({ id: "generic", collectionStage: "Escalated", escalationType: null });
    const legal = tpl({ id: "legal", collectionStage: "Escalated", escalationType: "Legal" });
    const { byStage, byStageAndType } = buildTemplateMaps([generic, legal]);

    // Invoice is escalated for "Retention", which has no type-specific template.
    const picked = pickTemplate(byStageAndType, byStage, "Escalated", "Retention");

    expect(picked?.id).toBe("generic");
  });

  it("does not match a stage that has only a type-specific template when the escalationType differs", () => {
    const legal = tpl({ id: "legal", collectionStage: "Escalated", escalationType: "Legal" });
    const { byStage, byStageAndType } = buildTemplateMaps([legal]);

    // No generic "Escalated" template exists at all here.
    const picked = pickTemplate(byStageAndType, byStage, "Escalated", "Retention");

    expect(picked).toBeUndefined();
  });

  it("matches on stage alone when the invoice has no escalationType", () => {
    const generic = tpl({ id: "generic", collectionStage: "Escalated", escalationType: null });
    const { byStage, byStageAndType } = buildTemplateMaps([generic]);

    const picked = pickTemplate(byStageAndType, byStage, "Escalated", null);

    expect(picked?.id).toBe("generic");
  });
});
