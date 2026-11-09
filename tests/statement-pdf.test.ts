import { describe, it, expect } from "vitest";
import { buildStatementHtml, safeLogoSrc } from "@/lib/statement-pdf";

const rows = [{
  inv: { invoiceNumber: "8518", invoiceDate: "2026-05-31", dueDate: "2026-06-30", currency: "EUR", total: 12705.3 },
  custName: "HQ Developments Ltd", projName: "17003 - Horgans Quay", bal: 12705.3, days: 132,
}];
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("statement logo", () => {
  it("draws an uploaded (inline) logo — the reported bug", () => {
    const { html } = buildStatementHtml({ orgName: "EDC Engineering Design Consultants", rows, logoUrl: PNG });
    expect(html).toContain(`<img class="logo" src="${PNG}"`);
    expect(html).not.toContain(`class="mono"`);
  });
  it("draws an https logo", () => {
    expect(safeLogoSrc("https://blob.example.com/logo.png")).toBe("https://blob.example.com/logo.png");
  });
  it("falls back to the monogram when there is no logo", () => {
    const { html } = buildStatementHtml({ orgName: "EDC Engineering", rows, logoUrl: null });
    expect(html).toContain(`<div class="mono">ED</div>`);
  });
  it("refuses anything that is not an https or inline image", () => {
    for (const bad of ["javascript:alert(1)", "http://x.test/a.png", 'https://x.test/a.png" onerror="x', "data:text/html;base64,PHNjcmlwdD4=", "data:image/png;base64,<script>"]) {
      const s = safeLogoSrc(bad);
      expect(s === null || !s.includes('"')).toBe(true);
    }
    expect(safeLogoSrc("javascript:alert(1)")).toBeNull();
    expect(safeLogoSrc("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(safeLogoSrc("data:image/png;base64,<script>")).toBeNull();
  });
});

describe("statement column headings", () => {
  it("right-aligned headings beat the table's left-align rule", () => {
    const { html } = buildStatementHtml({ orgName: "EDC", rows, logoUrl: null });
    // A bare "th.r" loses to "table.lines th" on specificity.
    expect(html).toContain("table.lines th.r,table.lines td.r{text-align:right}");
    expect(html).toMatch(/<th class="r">Amount<\/th>/);
  });
});
