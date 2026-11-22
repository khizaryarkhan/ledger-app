import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Paying a native bill used to leave its Payables row (ap_bills) "Unpaid" with the
// full balance, because only invoices were re-synced after a settlement. No database
// here, so this pins the wiring at source level: every place that re-syncs invoices
// after a payment is created, edited, deleted or reversed must re-sync bills too.
const src = readFileSync(join(__dirname, "..", "lib", "accounting", "documents.ts"), "utf8");

describe("native bill paid sync", () => {
  it("defines syncNativeBillPaid and writes amount, balance and status", () => {
    const body = src.slice(src.indexOf("export async function syncNativeBillPaid"));
    const fn = body.slice(0, body.indexOf("\nexport async function syncNativeInvoicePaid"));
    expect(fn).toContain("amountPaid");
    expect(fn).toContain("balance");
    expect(fn).toContain("accountingPaymentStatus");
  });

  it("re-syncs bills at every site where invoices are re-synced after a settlement", () => {
    const billCalls = src.match(/syncNativeBillPaid\(orgId,/g) ?? [];
    // create, edit, delete, reverse
    expect(billCalls.length).toBeGreaterThanOrEqual(4);
  });

  it("runs the post-create sync for BillPayment as well as Payment", () => {
    expect(src).toContain('(type === "Payment" || type === "BillPayment")');
  });
});
