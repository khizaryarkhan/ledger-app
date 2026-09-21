/**
 * A journal line's "Name" is a QuickBooks Entity ref, and QBO allows it to be a
 * CUSTOMER, a VENDOR or an EMPLOYEE.
 *
 * Reported live: "Journal Entry — the export does not have the Supplier names
 * in the drop down of the Name field, only Customer names appear. For the names
 * column we should cover everything that QBO allows."
 *
 * The dropdown was the visible half. The worse half was the export: the mapper
 * resolved the Entity ref against the Customer list ONLY, so a line whose Name
 * was a supplier came out BLANK — and re-uploading that sheet then cleared the
 * reference on the record itself, because an update replaces every line.
 *
 * buildJournalEntry had always accepted all three on the way in, so the two
 * halves of the round trip disagreed. This pins all three ends together:
 * what the picker offers, what the export writes, and what the import reads.
 */
import { describe, it, expect } from "vitest";
import { dropdownKindsForColumn } from "@/lib/batch/dropdowns";
import { refKindForColumn, entityRefKinds } from "@/lib/batch/ref-columns";
import { getEntity } from "@/lib/batch/entities";

describe("the Name dropdown covers every list QBO allows", () => {
  it("offers customers, vendors AND employees on a journal entry", () => {
    const kinds = dropdownKindsForColumn("Name", "journalentry");
    expect(kinds).toContain("Customer");
    expect(kinds).toContain("Vendor");   // the reported gap
    expect(kinds).toContain("Employee");
  });

  it("still offers Employee and Vendor on a time activity", () => {
    expect(dropdownKindsForColumn("Name", "timeactivity").sort()).toEqual(["Employee", "Vendor"]);
  });

  it("does NOT put a dropdown on an entity's own-name column", () => {
    // account/class/department/item use "Name" for the record's own name — a
    // reference dropdown there would be nonsense.
    for (const e of ["account", "class", "department", "item"]) {
      expect(dropdownKindsForColumn("Name", e), e).toEqual([]);
      expect(refKindForColumn("Name", e), e).toBeNull();
    }
  });
});

describe("the journal entry entity preloads the lists it actually needs", () => {
  const je = getEntity("journalentry")!;

  it("resolves names on the way IN — builder side", () => {
    // buildJournalEntry does tryResolve on Customer, then Vendor, then
    // Employee. Without these preloaded each row falls back to a lazy fetch.
    for (const k of ["Customer", "Vendor", "Employee"]) {
      expect(je.refs, `refs missing ${k}`).toContain(k);
    }
  });

  it("resolves ids back to names on the way OUT — export side", () => {
    // reverseRefs is what the download route preloads so the mapper can turn a
    // supplier's internal id back into a display name. Missing Vendor here is
    // precisely why supplier names exported blank.
    for (const k of ["Customer", "Vendor", "Employee"]) {
      expect(je.reverseRefs, `reverseRefs missing ${k}`).toContain(k);
    }
  });

  it("keeps the Account/Class/Location refs it already had", () => {
    for (const k of ["Account", "Class", "Department"]) {
      expect(je.refs).toContain(k);
      expect(je.reverseRefs).toContain(k);
    }
  });

  it("entityRefKinds still reports Name's primary kind for the override picker", () => {
    // The single-kind table drives the override picker, which is a different
    // surface from the spreadsheet dropdown — it should keep working.
    expect(entityRefKinds(je)).toContain("Customer");
  });
});
