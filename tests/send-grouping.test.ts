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

  it("skips a customer whose contacts span two domains", () => {
    const { groups } = groupByCustomer([
      row("c1", "Split Ltd", "a@acme.com"),
      row("c1", "Split Ltd", "b@other.com"),
      row("c2", "Acme Two", "c@acme.com"),
    ]);
    // Only one *whole-domain* customer remains on acme.com, so nothing to merge.
    expect(mergeCandidates(groups)).toEqual([]);
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
