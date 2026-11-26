import { describe, it, expect } from "vitest";
import {
  isConsumerDomain, groupByCustomer, mergeCandidates, applyMerges, uniqEmails,
} from "@/lib/send-grouping";

const row = (custId: string, custName: string, email: string | null, bal = 100) =>
  ({ custId, custName, email, bal });

describe("isConsumerDomain", () => {
  it("catches the providers that caused the incident", () => {
    for (const d of ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"]) {
      expect(isConsumerDomain(d)).toBe(true);
    }
  });
  it("catches country variants without enumerating them", () => {
    for (const d of ["yahoo.co.uk", "yahoo.com.br", "hotmail.fr", "live.com.au", "outlook.de"]) {
      expect(isConsumerDomain(d)).toBe(true);
    }
  });
  it("leaves corporate domains alone", () => {
    for (const d of ["acme.com", "edcengineers.com", "stkate.edu", "salud.unm.edu", "nhs.uk"]) {
      expect(isConsumerDomain(d)).toBe(false);
    }
  });
  it("is not fooled by a corporate domain that merely contains a provider name", () => {
    expect(isConsumerDomain("gmail.acme.com")).toBe(false);
    expect(isConsumerDomain("notgmail.com")).toBe(false);
  });
});

describe("groupByCustomer", () => {
  it("NEVER puts two customers in one group — the actual bug", () => {
    // 185 different people who all happen to use Gmail. Domain grouping put
    // every one of them in a single email with all 185 addresses in To:.
    const rows = Array.from({ length: 185 }, (_, i) =>
      row(`c${i}`, `Customer ${i}`, `person${i}@gmail.com`));
    const { groups } = groupByCustomer(rows);
    expect(groups).toHaveLength(185);
    for (const g of groups) {
      expect(g.custIds).toHaveLength(1);
      expect(g.emails).toHaveLength(1);
    }
  });

  it("keeps one customer's several invoices and contacts together", () => {
    const { groups } = groupByCustomer([
      row("c1", "Acme", "ap@acme.com", 100),
      row("c1", "Acme", "ap@acme.com", 250),
      row("c1", "Acme", "cfo@acme.com", 50),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(3);
    expect(groups[0].total).toBe(400);
    expect(groups[0].emails.sort()).toEqual(["ap@acme.com", "cfo@acme.com"]);
  });

  it("separates rows with no email instead of folding them into someone else", () => {
    const { groups, noEmail } = groupByCustomer([
      row("c1", "Acme", "ap@acme.com"),
      row("c2", "NoMail Ltd", null),
      row("c3", "Blank Ltd", "   "),
    ]);
    expect(groups).toHaveLength(1);
    expect(noEmail).toHaveLength(2);
  });

  it("orders by balance, largest first", () => {
    const { groups } = groupByCustomer([
      row("c1", "Small", "a@a.com", 10),
      row("c2", "Big", "b@b.com", 900),
    ]);
    expect(groups.map(g => g.label)).toEqual(["Big", "Small"]);
  });
});

describe("mergeCandidates", () => {
  it("offers a shared CORPORATE domain — the novated-project case", () => {
    const { groups } = groupByCustomer([
      row("c1", "Acme North", "north@acme.com"),
      row("c2", "Acme South", "south@acme.com"),
    ]);
    const c = mergeCandidates(groups);
    expect(c).toHaveLength(1);
    expect(c[0].domain).toBe("acme.com");
    expect(c[0].custNames.sort()).toEqual(["Acme North", "Acme South"]);
  });

  it("NEVER offers a consumer domain, however many customers share it", () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      row(`c${i}`, `Person ${i}`, `p${i}@gmail.com`));
    expect(mergeCandidates(groupByCustomer(rows).groups)).toEqual([]);
  });

  it("does not offer a domain only one customer uses", () => {
    const { groups } = groupByCustomer([row("c1", "Solo", "a@solo.com")]);
    expect(mergeCandidates(groups)).toEqual([]);
  });

  it("skips a group whose contacts span two domains (same project, two organisations)", () => {
    const { groups } = groupByCustomer([
      { ...row("c1", "Split Ltd", "a@acme.com"), projectId: "p1" },
      { ...row("c1", "Split Ltd", "b@other.com"), projectId: "p1" },
      row("c2", "Acme Two", "c@acme.com"),
    ]);
    // c1's one project group sits on two domains, so only c2 is left on acme.com.
    expect(mergeCandidates(groups)).toEqual([]);
  });
});

describe("groupByCustomer — entities within a customer", () => {
  const inv = (email: string, projectId: string | null, projName: string | null, bal = 100) =>
    ({ ...row("amhola", "Amhola Capital", email, bal), projectId, projName });

  it("splits projects whose contacts are on different domains — the Aidan incident", () => {
    const { groups } = groupByCustomer([
      inv("aidan@healy.com", "p-tralee", "Tralee"),
      inv("dg@axis.construction", "p-rolestown", "Rolestown"),
      inv("dg@axis.construction", "p-gorey", "Gorey"),
    ]);
    expect(groups).toHaveLength(2);
    const healy = groups.find(g => g.emails.includes("aidan@healy.com"))!;
    expect(healy.emails).toEqual(["aidan@healy.com"]);
    expect(healy.rows).toHaveLength(1);
    const axis = groups.find(g => g.emails.includes("dg@axis.construction"))!;
    expect(axis.emails).toEqual(["dg@axis.construction"]);
    expect(axis.rows).toHaveLength(2);
  });

  it("keeps one group per customer when everything shares a domain", () => {
    const { groups } = groupByCustomer([
      inv("a@axis.construction", "p1", "One"),
      inv("b@axis.construction", "p2", "Two"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("amhola");
    expect(groups[0].label).toBe("Amhola Capital");
  });

  it("combines several domains inside ONE project", () => {
    const { groups } = groupByCustomer([
      inv("a@owner.com", "p1", "Tralee"),
      inv("b@contractor.com", "p1", "Tralee"),
      inv("c@other.com", "p2", "Gorey"),
    ]);
    expect(groups).toHaveLength(2);
    const tralee = groups.find(g => g.rows.length === 2)!;
    expect(tralee.emails.sort()).toEqual(["a@owner.com", "b@contractor.com"]);
  });

  it("never links two rows on a personal mailbox domain", () => {
    const { groups } = groupByCustomer([
      inv("sam@gmail.com", null, null),
      inv("kim@gmail.com", null, null),
    ]);
    expect(groups).toHaveLength(2);
    for (const g of groups) expect(g.emails).toHaveLength(1);
  });

  it("does link rows that share the exact same personal address", () => {
    const { groups } = groupByCustomer([
      inv("sam@gmail.com", null, null),
      inv("sam@gmail.com", null, null),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });

  it("warns when a personal address would see invoices it is not on", () => {
    const { groups } = groupByCustomer([
      inv("a@owner.com, sam@gmail.com", "p1", "Tralee"),
      inv("a@owner.com", "p1", "Tralee"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].warnings.join(" ")).toContain("sam@gmail.com");
  });

  it("gives each entity a distinct, stable key and a descriptive label", () => {
    const rows = [
      inv("aidan@healy.com", "p1", "Tralee"),
      inv("dg@axis.construction", "p2", "Gorey"),
    ];
    const a = groupByCustomer(rows).groups;
    const b = groupByCustomer([...rows].reverse()).groups;
    expect(new Set(a.map(g => g.key)).size).toBe(2);
    expect(a.map(g => g.key).sort()).toEqual(b.map(g => g.key).sort());
    expect(a.map(g => g.label).sort()).toEqual(["Amhola Capital · Gorey", "Amhola Capital · Tralee"]);
  });

  it("merging a domain pulls in only the entity on that domain, not the customer's others", () => {
    const { groups } = groupByCustomer([
      inv("a@shared.com", "p1", "One"),
      inv("b@private.com", "p2", "Two"),
      { ...row("c2", "Other Co", "x@shared.com") },
    ]);
    const out = applyMerges(groups, new Set(["shared.com"]), mergeCandidates(groups));
    const merged = out.find(g => g.key === "merge:shared.com")!;
    expect(merged.custIds.sort()).toEqual(["amhola", "c2"]);
    expect(merged.rows).toHaveLength(2);
    expect(out.some(g => g.emails.includes("b@private.com") && g.key !== "merge:shared.com")).toBe(true);
  });
});

describe("applyMerges", () => {
  it("is a no-op when the user ticks nothing — the safe default", () => {
    const { groups } = groupByCustomer([
      row("c1", "Acme North", "north@acme.com"),
      row("c2", "Acme South", "south@acme.com"),
    ]);
    expect(applyMerges(groups, new Set(), mergeCandidates(groups))).toHaveLength(2);
  });

  it("combines only the domain that was ticked, leaving the rest alone", () => {
    const { groups } = groupByCustomer([
      row("c1", "Acme North", "north@acme.com", 100),
      row("c2", "Acme South", "south@acme.com", 200),
      row("c3", "Beta One", "one@beta.com", 300),
      row("c4", "Beta Two", "two@beta.com", 400),
    ]);
    const out = applyMerges(groups, new Set(["acme.com"]), mergeCandidates(groups));
    const acme = out.find(g => g.key === "merge:acme.com")!;
    expect(acme.custIds.sort()).toEqual(["c1", "c2"]);
    expect(acme.total).toBe(300);
    expect(acme.emails.sort()).toEqual(["north@acme.com", "south@acme.com"]);
    // beta stays split
    expect(out.filter(g => g.custIds.length === 1).map(g => g.label).sort())
      .toEqual(["Beta One", "Beta Two"]);
  });
});

describe("uniqEmails", () => {
  it("splits, lowercases and de-duplicates", () => {
    expect(uniqEmails(["A@X.com, b@x.com; A@x.com", null, "c@x.com"]).sort())
      .toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });
});
