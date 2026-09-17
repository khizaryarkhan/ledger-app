/**
 * Which spreadsheet rows are the same QuickBooks document?
 *
 * This destroyed a customer's data. They downloaded Expenses from Data Studio,
 * added a Class, re-uploaded, and expense lines vanished from QuickBooks.
 *
 * Grouping was done on the entity's docKey ("Ref No" = DocNumber). DocNumber is
 * OPTIONAL on a QBO Purchase and blank on most card spend, and blank values were
 * given a unique key PER ROW — so one three-line expense became three separate
 * "documents", each carrying the same record Id, each sent as its own
 * non-sparse update. A non-sparse update replaces the entire Line array, so
 * every write wiped the one before it and only the last line survived.
 *
 * The opposite failure was equally real: two genuinely different expenses that
 * share a Ref No (QBO does not enforce uniqueness on Purchase.DocNumber) merged
 * into one document, and commitOneDoc takes the id from rows[0] — so one record
 * got both records' lines and the other was silently never written.
 *
 * Grouping on the record id fixes both, because the id is what the update
 * actually writes to.
 */
import { describe, it, expect } from "vitest";
import { groupDocs } from "@/lib/batch/engine";

const EXPENSE = { docKey: "Ref No" };

describe("an update groups on the QuickBooks record id", () => {
  it("keeps a multi-line expense with NO Ref No as ONE document", () => {
    // The exact shape that lost data: same Id, blank Ref No, three lines.
    const rows: any[] = [
      { Id: "247", SyncToken: "3", "Ref No": "", "Expense Account": "Office Supplies", "Expense Line Amount": 120 },
      { Id: "247", SyncToken: "3", "Ref No": "", "Expense Account": "Software",        "Expense Line Amount": 340 },
      { Id: "247", SyncToken: "3", "Ref No": "", "Expense Account": "Travel",          "Expense Line Amount":  60 },
    ];
    const docs = groupDocs(rows, EXPENSE);
    expect(docs).toHaveLength(1);
    expect(docs[0].rows).toHaveLength(3);
    // All three lines survive into the single update that gets sent.
    expect(docs[0].rows.map((r: any) => r["Expense Line Amount"])).toEqual([120, 340, 60]);
  });

  it("does not merge two DIFFERENT records that share a Ref No", () => {
    const rows: any[] = [
      { Id: "300", "Ref No": "1001", "Expense Account": "Rent",     "Expense Line Amount": 900 },
      { Id: "301", "Ref No": "1001", "Expense Account": "Cleaning", "Expense Line Amount": 150 },
    ];
    const docs = groupDocs(rows, EXPENSE);
    expect(docs).toHaveLength(2);
    expect(docs.map(d => (d.rows[0] as any).Id).sort()).toEqual(["300", "301"]);
  });

  it("groups interleaved rows — the sheet's order is not a grouping rule", () => {
    // Sorting a spreadsheet by amount or account is an ordinary thing to do,
    // and must not change which record a line belongs to.
    const rows: any[] = [
      { Id: "A", "Ref No": "" }, { Id: "B", "Ref No": "" },
      { Id: "A", "Ref No": "" }, { Id: "B", "Ref No": "" }, { Id: "A", "Ref No": "" },
    ];
    const docs = groupDocs(rows, EXPENSE);
    expect(docs).toHaveLength(2);
    expect(docs.find(d => (d.rows[0] as any).Id === "A")!.rows).toHaveLength(3);
    expect(docs.find(d => (d.rows[0] as any).Id === "B")!.rows).toHaveLength(2);
  });

  it("accepts the 'QBO Id' spelling too", () => {
    const rows: any[] = [
      { "QBO Id": "88", "Ref No": "" },
      { "QBO Id": "88", "Ref No": "" },
    ];
    expect(groupDocs(rows, EXPENSE)).toHaveLength(1);
  });

  it("an id beats a docKey when the two disagree", () => {
    // Same record, but someone edited the Ref No on one line. It is still one
    // record — the id says so, and the id is what gets written.
    const rows: any[] = [
      { Id: "55", "Ref No": "OLD" },
      { Id: "55", "Ref No": "NEW" },
    ];
    expect(groupDocs(rows, EXPENSE)).toHaveLength(1);
  });
});

describe("a create is unaffected — it has no id to group on", () => {
  it("still groups on the docKey", () => {
    const rows: any[] = [
      { "Ref No": "E-1", "Expense Account": "Rent" },
      { "Ref No": "E-1", "Expense Account": "Rates" },
      { "Ref No": "E-2", "Expense Account": "Travel" },
    ];
    const docs = groupDocs(rows, EXPENSE);
    expect(docs).toHaveLength(2);
    expect(docs[0].rows).toHaveLength(2);
  });

  it("still treats each blank-docKey row as its own document", () => {
    // Unchanged on purpose. On a create there is no identity to group by, and
    // merging every blank-ref row into one document would be a guess that
    // silently combines unrelated expenses.
    const rows: any[] = [{ "Ref No": "" }, { "Ref No": "" }];
    expect(groupDocs(rows, EXPENSE)).toHaveLength(2);
  });

  it("flat entities with no docKey still get one document per row", () => {
    const rows: any[] = [{ Name: "A" }, { Name: "B" }, { Name: "C" }];
    expect(groupDocs(rows, {})).toHaveLength(3);
  });
});

describe("partially filled sheets", () => {
  it("does not fall back to docKey for the rows that DO carry an id", () => {
    // A user pasting new rows under downloaded ones is ordinary. The downloaded
    // rows must still group by identity; only the new ones fall back.
    const rows: any[] = [
      { Id: "9", "Ref No": "" },
      { Id: "9", "Ref No": "" },
      { "Ref No": "NEW-1" },
    ];
    const docs = groupDocs(rows, EXPENSE);
    expect(docs).toHaveLength(2);
    expect(docs.find(d => (d.rows[0] as any).Id === "9")!.rows).toHaveLength(2);
  });
});
