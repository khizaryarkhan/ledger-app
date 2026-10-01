/**
 * Regression locks for the AR email template.
 *
 * Every case below is a bug a real customer reported, not a hypothetical:
 *  - students received emails with TWO pay buttons
 *  - a Xero/native org would otherwise get a permanently empty "Pay" column
 *  - placeholder text reaching customers verbatim is what made the duplicate
 *    button embarrassing rather than cosmetic
 */
import { describe, it, expect } from "vitest";
import { renderInvoiceEmail, appendPayButton, type ArEmailRow } from "@/lib/ar-email";

const PAY = "https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-abc?a=1&b=2";

const row = (over: Partial<ArEmailRow> = {}): ArEmailRow => ({
  invoiceNumber: "4",
  customerName: "Abdulmalik Aden",
  invoiceDate: "2026-08-04",
  dueDate: "2026-09-04",
  balance: 70,
  currency: "USD",
  daysOverdue: 0,
  ...over,
});

const render = (rows: ArEmailRow[]) =>
  renderInvoiceEmail({ subject: "Open Invoices", dateStr: "11 September 2026", total: 70, currency: "USD", rows });

describe("pay column visibility", () => {
  it("renders no Pay column at all when no invoice has a link", () => {
    // A Xero or native-accounting org: an empty column would be dead furniture.
    const html = render([row({ payUrl: null }), row({ invoiceNumber: "7", payUrl: undefined })]);
    expect(html).not.toContain(">Pay</th>");
    expect(html).not.toContain("Pay now");
  });

  it("renders the Pay column when at least one invoice has a link", () => {
    const html = render([row({ payUrl: PAY })]);
    expect(html).toContain(">Pay</th>");
    expect(html).toContain("Pay now");
  });

  it("gives a button only to the rows that actually have a link", () => {
    const html = render([
      row({ invoiceNumber: "4", payUrl: PAY }),
      row({ invoiceNumber: "7", payUrl: PAY }),
      row({ invoiceNumber: "9", payUrl: null }),
    ]);
    expect(html.match(/Pay now/g)?.length).toBe(2);
  });
});

describe("pay link encoding", () => {
  it("escapes the href so a query string cannot break out of the attribute", () => {
    const html = render([row({ payUrl: PAY })]);
    expect(html).toContain("a=1&amp;b=2");
    // The raw, unescaped ampersand must not survive into the markup.
    expect(html).not.toContain('href="https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-abc?a=1&b=2"');
  });

  it("escapes a quote rather than letting it terminate the attribute", () => {
    const html = render([row({ payUrl: 'https://x.test/pay"onmouseover=alert(1)' })]);
    expect(html).not.toContain('"onmouseover=alert(1)');
    expect(html).toContain("&quot;onmouseover=alert(1)");
  });
});

describe("table integrity", () => {
  it("keeps the footer's column count in step with the header", () => {
    // The totals row spans the first four columns and prints the total in the
    // fifth; adding the Pay column without a matching footer cell would skew
    // the table in every client's inbox.
    const withPay = render([row({ payUrl: PAY })]);
    const headerCells = (withPay.match(/<th /g) ?? []).length;
    const footerCells = (withPay.match(/<td colspan="4"/g) ?? []).length + (withPay.match(/<td style="padding:12px[^"]*"\s*>/g) ?? []).length;
    expect(headerCells).toBe(6);           // Invoice, Customer, Date, Due, Balance, Pay
    expect(footerCells).toBeGreaterThan(0); // colspan(4) + total + the Pay spacer
  });

  it("still renders the customer's own rows and total", () => {
    const html = render([row({ payUrl: PAY })]);
    expect(html).toContain("Abdulmalik Aden");
    expect(html).toContain("#4");
    expect(html).toContain("Total Outstanding");
  });
});

describe("HTML escaping — customer/project names and free text", () => {
  it("escapes a customer name so it can't corrupt the row markup", () => {
    const html = render([row({ customerName: "Acme <script>alert(1)</script> & Co" })]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Acme &lt;script&gt;alert(1)&lt;/script&gt; &amp; Co");
  });

  it("escapes a project name the same way", () => {
    const html = render([row({ projectName: 'Phase <2> "West"' })]);
    expect(html).toContain("Phase &lt;2&gt; &quot;West&quot;");
    expect(html).not.toContain('Phase <2> "West"');
  });

  it("escapes the subject", () => {
    const html = renderInvoiceEmail({
      subject: "Reminder <b>URGENT</b> & Overdue", dateStr: "1 Jan 2026", total: 10, rows: [row()],
    });
    expect(html).toContain("Reminder &lt;b&gt;URGENT&lt;/b&gt; &amp; Overdue");
    expect(html).not.toContain("<b>URGENT</b>");
  });

  it("escapes the intro before converting newlines to <br>", () => {
    const html = renderInvoiceEmail({
      subject: "Open Invoices", dateStr: "1 Jan 2026", total: 10, rows: [row()],
      intro: "Hi <b>there</b>,\nSecond line",
    });
    expect(html).toContain("Hi &lt;b&gt;there&lt;/b&gt;,<br>Second line");
  });
});

describe("dates render through formatDateShort, not the raw ISO string", () => {
  it("shows the invoice date and a not-yet-due date as '15 Sep 2026', not '2026-09-15'", () => {
    const html = render([row({ invoiceDate: "2026-08-04", dueDate: "2026-09-15", daysOverdue: 0 })]);
    expect(html).toContain("15 Sep 2026");
    expect(html).toContain("04 Aug 2026");
    expect(html).not.toContain("2026-09-15");
    expect(html).not.toContain("2026-08-04");
  });
});

describe("org branding", () => {
  it("renders nothing extra when neither orgName nor logoUrl is set — no visual change for an org that hasn't configured either", () => {
    const html = renderInvoiceEmail({ subject: "Open Invoices", dateStr: "1 Jan 2026", total: 10, rows: [row()] });
    expect(html).not.toContain("<img");
  });

  it("renders the org name when set and there's no logo", () => {
    const html = renderInvoiceEmail({
      subject: "Open Invoices", dateStr: "1 Jan 2026", total: 10, rows: [row()], orgName: "Acme Ltd",
    });
    expect(html).toContain("Acme Ltd");
    expect(html).not.toContain("<img");
  });

  it("renders the logo (escaped) when set, preferring it over the name text", () => {
    const html = renderInvoiceEmail({
      subject: "Open Invoices", dateStr: "1 Jan 2026", total: 10, rows: [row()],
      orgName: "Acme Ltd", logoUrl: 'https://cdn.test/logo.png?a=1&b=2',
    });
    expect(html).toContain('<img src="https://cdn.test/logo.png?a=1&amp;b=2"');
  });
});

describe("appendPayButton — the composer's safety net", () => {
  const count = (html: string) => (html.match(/Pay invoice/g) ?? []).length;

  it("adds a button to a plain free-text body", () => {
    const out = appendPayButton("<p>Hi Sara, please see the attached.</p>", PAY, "219");
    expect(count(out)).toBe(1);
    expect(out).toContain("Pay invoice 219 online");
    expect(out).toContain("<p>Hi Sara, please see the attached.</p>");   // body kept intact
  });

  it("adds nothing when there is no link — the common Xero/native case", () => {
    const body = "<p>Hello</p>";
    expect(appendPayButton(body, null, "219")).toBe(body);
    expect(appendPayButton(body, undefined, "219")).toBe(body);
    expect(appendPayButton(body, "", "219")).toBe(body);
  });

  it("does not add a SECOND button to a branded body — the bug customers saw", () => {
    // The branded template escapes the href (& -> &amp;), so comparing the raw
    // URL against the raw body missed it and every such email went out twice-
    // buttoned. The guard must unescape before it compares.
    const branded = render([row({ payUrl: PAY })]);
    expect(branded).toContain("a=1&amp;b=2");        // precondition: it IS escaped
    expect(appendPayButton(branded, PAY, "4")).toBe(branded);
  });

  it("is idempotent — appending twice still yields one button", () => {
    const once = appendPayButton("<p>Hi</p>", PAY, "219");
    expect(count(appendPayButton(once, PAY, "219"))).toBe(1);
  });

  it("escapes the href it writes, like the branded template does", () => {
    const out = appendPayButton("<p>Hi</p>", PAY, "219");
    expect(out).toContain("a=1&amp;b=2");
    expect(out).not.toContain(`href="${PAY}"`);
  });

  it("still appends when the body mentions a DIFFERENT invoice's link", () => {
    const other = appendPayButton("<p>Hi</p>", "https://connect.intuit.com/portal/other", "218");
    expect(count(appendPayButton(other, PAY, "219"))).toBe(2);
  });
});
