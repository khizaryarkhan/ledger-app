import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * db/schema.ts says trade_document_lines.document_id cascades, but no migration ever created that foreign key,
 * so deleting only the header left orphan lines. They then blocked deleting the item ("in use by N order lines")
 * with no document left to remove. deleteTradeDoc must remove the lines itself, before the header.
 */
describe("deleteTradeDoc", () => {
  const src = readFileSync("lib/accounting/trade-documents.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function deleteTradeDoc"), src.indexOf("export async function listTradeDocs"));

  it("deletes the document's lines explicitly, before its header", () => {
    const lines = fn.indexOf("db.delete(tradeDocumentLines)");
    const header = fn.indexOf("db.delete(tradeDocuments)");
    expect(lines).toBeGreaterThan(-1);
    expect(header).toBeGreaterThan(-1);
    expect(lines).toBeLessThan(header);
  });

  it("does not rely on a cascade that the database does not have", () => {
    expect(fn).not.toMatch(/lines cascade/);
  });
});
