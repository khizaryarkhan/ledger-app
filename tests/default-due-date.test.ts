import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Found by the MSQ / Test Organization pass: an invoice from shipments or from an estimate was posted with no due
 * date and no terms. The ledger aged it as Current (no due date = not due) while the invoice register dated it due
 * the day it was issued, so the accounting dashboard said $575 Current and the Executive Overview said $125 overdue.
 * Two rules now agree: postDocument fills terms from the party, and aging treats a missing due date as the document date.
 */
describe("due dates agree between the ledger and the register", () => {
  const docs = readFileSync("lib/accounting/documents.ts", "utf8");
  const analysis = readFileSync("lib/accounting/analysis.ts", "utf8");
  const post = docs.slice(docs.indexOf("export async function postDocument"));

  it("postDocument takes the party's payment terms when neither a due date nor terms are given", () => {
    const head = post.slice(0, post.indexOf("const facts = entryFacts"));
    expect(head).toMatch(/DATED_TYPES\.has\(type\)\s*&&\s*!input\.dueDate\s*&&\s*input\.termsDays\s*==\s*null/);
    expect(head).toMatch(/partyPaymentTerms\(orgId, input\.partyType, input\.partyId\)/);
  });

  it("looks the terms up in the customer or supplier of THIS org", () => {
    const fn = docs.slice(docs.indexOf("async function partyPaymentTerms"), docs.indexOf("async function lockPartyCurrency"));
    expect(fn).toMatch(/customers\.orgId, orgId/);
    expect(fn).toMatch(/apSuppliers\.orgId, orgId/);
  });

  it("aging reads a missing due date as the document's own date, not as not-yet-due", () => {
    const fn = analysis.slice(analysis.indexOf("export async function aging"));
    expect(fn).toMatch(/daysBetween\(asOf, r\.dueDate \?\? r\.date\)/);
    expect(fn).not.toMatch(/r\.dueDate \? daysBetween\(asOf, r\.dueDate\) : 0/);
  });
});
