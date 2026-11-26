import { describe, it, expect } from "vitest";
import {
  summarisePriorReferences, formatRefDate, PRIOR_REFS_HEADING, PRIOR_REFS_EMAIL_LIMIT,
} from "@/lib/prior-references";
import { renderInvoiceEmail } from "@/lib/ar-email";
import { buildStatementHtml } from "@/lib/statement-pdf";

const nums = { a: "8919", b: "8781", c: "8902", z: "9000" };
const send = (invoiceId: string, ref: string | null, sentAt: string) => ({ invoiceId, ref, sentAt });

describe("summarisePriorReferences", () => {
  it("groups by reference with its date and the invoices it covered", () => {
    const { shown } = summarisePriorReferences([
      send("a", "AR-1", "2026-10-29T09:00:00Z"),
      send("b", "AR-1", "2026-10-29T09:00:01Z"),
      send("c", "AR-2", "2026-09-15T10:00:00Z"),
    ], nums);
    expect(shown).toEqual([
      { ref: "AR-1", date: "2026-10-29", invoiceNumbers: ["8781", "8919"] },
      { ref: "AR-2", date: "2026-09-15", invoiceNumbers: ["8902"] },
    ]);
  });

  it("lists the most recent first", () => {
    const { shown } = summarisePriorReferences([
      send("a", "OLD", "2026-01-01T00:00:00Z"),
      send("b", "NEW", "2026-06-01T00:00:00Z"),
    ], nums);
    expect(shown.map(s => s.ref)).toEqual(["NEW", "OLD"]);
  });

  it("ignores invoices that are not in this email — another project's reference never leaks", () => {
    const { shown } = summarisePriorReferences([
      send("a", "MINE", "2026-10-01T00:00:00Z"),
      send("not-in-email", "THEIRS", "2026-10-02T00:00:00Z"),
    ], nums);
    expect(shown.map(s => s.ref)).toEqual(["MINE"]);
  });

  it("ignores sends with no reference and invalid dates", () => {
    const { shown, earlier } = summarisePriorReferences([
      send("a", null, "2026-10-01T00:00:00Z"),
      send("a", "  ", "2026-10-01T00:00:00Z"),
      send("a", "AR-X", "not a date"),
    ], nums);
    expect(shown).toEqual([]);
    expect(earlier).toBe(0);
  });

  it("caps the list and counts what it left out", () => {
    const sends = Array.from({ length: 8 }, (_, i) =>
      send("a", `AR-${i}`, `2026-0${i + 1}-01T00:00:00Z`));
    const r = summarisePriorReferences(sends, nums);
    expect(r.shown).toHaveLength(PRIOR_REFS_EMAIL_LIMIT);
    expect(r.earlier).toBe(3);
    expect(r.shown[0].ref).toBe("AR-7");
  });

  it("returns everything when the limit is lifted (the statement)", () => {
    const sends = Array.from({ length: 8 }, (_, i) =>
      send("a", `AR-${i}`, `2026-0${i + 1}-01T00:00:00Z`));
    const r = summarisePriorReferences(sends, nums, Infinity);
    expect(r.shown).toHaveLength(8);
    expect(r.earlier).toBe(0);
  });
});

const baseEmail = {
  subject: "Open Invoices", dateStr: "26 November 2026", total: 100,
  rows: [{ invoiceNumber: "8919", customerName: "Reddy", projectName: null, invoiceDate: "2026-10-01",
    dueDate: "2026-10-31", balance: 100, currency: "EUR", daysOverdue: 5 }],
};

describe("email footer", () => {
  it("is absent on a first-time send", () => {
    expect(renderInvoiceEmail(baseEmail)).not.toContain(PRIOR_REFS_HEADING);
  });

  it("lists each reference with its date and invoice count", () => {
    const html = renderInvoiceEmail({
      ...baseEmail,
      priorReferences: {
        shown: [{ ref: "AR-261029-FF10", date: "2026-10-29", invoiceNumbers: ["8919", "8781"] }],
        earlier: 0,
      },
    });
    expect(html).toContain(PRIOR_REFS_HEADING);
    expect(html).toContain("AR-261029-FF10");
    expect(html).toContain("29-Oct-2026");
    expect(html).toContain("2 invoices");
  });

  it("points at the statement only when one is attached", () => {
    const pr = { shown: [{ ref: "AR-1", date: "2026-10-29", invoiceNumbers: ["1"] }], earlier: 2 };
    expect(renderInvoiceEmail({ ...baseEmail, priorReferences: { ...pr, earlierInStatement: true } }))
      .toContain("2 earlier, listed in the attached statement");
    const plain = renderInvoiceEmail({ ...baseEmail, priorReferences: { ...pr, earlierInStatement: false } });
    expect(plain).toContain("+ 2 earlier");
    expect(plain).not.toContain("attached statement");
  });

  it("escapes the reference", () => {
    const html = renderInvoiceEmail({
      ...baseEmail,
      priorReferences: { shown: [{ ref: "<img src=x>", date: "2026-10-29", invoiceNumbers: ["1"] }], earlier: 0 },
    });
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img src=x&gt;");
  });
});

describe("statement section", () => {
  const rows = [{ inv: { invoiceNumber: "8919", invoiceDate: "2026-10-01", dueDate: "2026-10-31", currency: "EUR", total: 100 },
    custName: "Reddy", projName: null, bal: 100, days: 5 }];

  it("is absent when there is nothing prior", () => {
    expect(buildStatementHtml({ orgName: "Org", rows }).html).not.toContain(PRIOR_REFS_HEADING);
  });

  it("lists every reference with its invoice numbers", () => {
    const { html } = buildStatementHtml({
      orgName: "Org", rows,
      priorReferences: [
        { ref: "AR-1", date: "2026-10-29", invoiceNumbers: ["8919", "8781"] },
        { ref: "AR-2", date: "2026-09-15", invoiceNumbers: ["8902"] },
      ],
    });
    expect(html).toContain(PRIOR_REFS_HEADING);
    for (const s of ["AR-1", "AR-2", "29-Oct-2026", "15-Sep-2026", "#8919", "#8781", "#8902"]) expect(html).toContain(s);
  });
});

describe("formatRefDate", () => {
  it("writes DD-MMM-YYYY", () => {
    expect(formatRefDate("2026-10-29")).toBe("29-Oct-2026");
    expect(formatRefDate("2026-01-05")).toBe("05-Jan-2026");
    expect(formatRefDate("2026-12-31")).toBe("31-Dec-2026");
  });
  it("leaves anything that is not a plain date alone", () => {
    expect(formatRefDate("29/10/2026")).toBe("29/10/2026");
    expect(formatRefDate("2026-13-01")).toBe("2026-13-01");
  });
});
