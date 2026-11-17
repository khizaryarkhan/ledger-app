import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { repeatedLotLines, requestedLotNumbers } from "@/lib/inventory/lot-numbers";

describe("lot numbers within one receipt", () => {
  it("keeps the first line's number and flags every later repeat (the receipt that lost 732.00 of stock)", () => {
    // Four lines pre-filled with the same peeked number, as the Receiving screen did.
    const repeats = repeatedLotLines(["LOT-S-000005", "LOT-S-000005", "lot-s-000005 ", "LOT-S-000005"]);
    expect([...repeats]).toEqual([1, 2, 3]);
  });

  it("ignores blanks and distinct numbers", () => {
    expect(repeatedLotLines(["A", "B", "", null, undefined, " "]).size).toBe(0);
    expect(repeatedLotLines(["", "", null]).size).toBe(0);
  });

  it("lists the numbers still being asked for, leaving out lines whose number is being replaced", () => {
    const req = ["LOT-1", "LOT-1", "LOT-2", "", "lot-2"];
    const repeats = repeatedLotLines(req);
    expect(requestedLotNumbers(req, repeats)).toEqual(["LOT-1", "LOT-2"]);
  });
});

describe("posting a goods receipt never leaves the ledger ahead of the stock", () => {
  const src = readFileSync("lib/inventory/receiving.ts", "utf8");
  const post = src.slice(src.indexOf("export async function postGoodsReceipt"), src.indexOf("async function preflightReceipt"));

  it("does not swallow a lot-creation failure after the journal entry has posted", () => {
    expect(post).not.toMatch(/\[receiving lot\]",\s*e\);\s*return null/);
    expect(post).toContain("lotFailures");
    expect(post).toContain("voidGoodsReceipt(orgId, receiptId)");
  });

  it("settles lot numbers before the journal entry is posted", () => {
    expect(post.indexOf("repeatedLotLines(")).toBeGreaterThan(-1);
    expect(post.indexOf("repeatedLotLines(")).toBeLessThan(post.indexOf("postJournalEntry({"));
  });
});
