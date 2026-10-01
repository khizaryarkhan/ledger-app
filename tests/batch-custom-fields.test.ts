import { describe, it, expect } from "vitest";
import { shapeModifyPayload } from "@/lib/batch/commit-one";
import { readCustomFieldEdits } from "@/lib/batch/builders";

// Custom fields (e.g. a QBO org's "PO Number" field on Estimates) were declared
// as a template column but never actually read or written — exactly the
// "three things must agree, or a column is a lie" bug class. These pin the
// fix: editing an EXISTING record's custom field value round-trips correctly,
// without ever inventing a DefinitionId the builder can't know.

describe("readCustomFieldEdits", () => {
  it("returns undefined when no Custom Field Value columns are set", () => {
    expect(readCustomFieldEdits({})).toBeUndefined();
    expect(readCustomFieldEdits({ "Custom Field Name (1)": "PO Number" })).toBeUndefined();
  });

  it("reads only the populated slots into a sparse 0-indexed map", () => {
    expect(readCustomFieldEdits({ "Custom Field Value (2)": "PO-123" })).toEqual({ 1: "PO-123" });
  });

  it("reads all three slots when all three are set", () => {
    expect(readCustomFieldEdits({
      "Custom Field Value (1)": "a",
      "Custom Field Value (2)": "b",
      "Custom Field Value (3)": "c",
    })).toEqual({ 0: "a", 1: "b", 2: "c" });
  });

  it("trims whitespace and ignores a blank cell", () => {
    expect(readCustomFieldEdits({ "Custom Field Value (1)": "  PO-9  ", "Custom Field Value (2)": "   " }))
      .toEqual({ 0: "PO-9" });
  });
});

describe("shapeModifyPayload — custom field merge", () => {
  const existingWithOneCustomField = {
    CustomField: [{ DefinitionId: "1", Name: "PO Number", Type: "StringType", StringValue: "OLD-PO" }],
  };

  it("applies a typed value onto the existing custom field, keeping its DefinitionId/Name", () => {
    const payload = { Line: [{ Amount: 1 }], __customFieldEdits: { 0: "NEW-PO" } };
    const out = shapeModifyPayload(payload, "123", "4", existingWithOneCustomField);
    expect(out.CustomField).toEqual([
      { DefinitionId: "1", Name: "PO Number", Type: "StringType", StringValue: "NEW-PO" },
    ]);
  });

  it("never leaks __customFieldEdits into the outgoing payload", () => {
    const payload = { Line: [{ Amount: 1 }], __customFieldEdits: { 0: "NEW-PO" } };
    const out = shapeModifyPayload(payload, "123", "4", existingWithOneCustomField);
    expect(out).not.toHaveProperty("__customFieldEdits");
  });

  it("is a no-op for a slot the existing record doesn't have — no DefinitionId to invent", () => {
    const payload = { Line: [{ Amount: 1 }], __customFieldEdits: { 1: "NEW-PO" } }; // slot 2, only slot 1 exists
    const out = shapeModifyPayload(payload, "123", "4", existingWithOneCustomField);
    expect(out.CustomField).toEqual(existingWithOneCustomField.CustomField);
  });

  it("still preserves the existing CustomField array unchanged when nothing was typed (pre-existing behaviour)", () => {
    const payload = { Line: [{ Amount: 1 }] };
    const out = shapeModifyPayload(payload, "123", "4", existingWithOneCustomField);
    expect(out.CustomField).toEqual(existingWithOneCustomField.CustomField);
  });

  it("sets nothing when the existing record has no CustomField at all (can't invent one on an existing-but-unset slot)", () => {
    const payload = { Line: [{ Amount: 1 }], __customFieldEdits: { 0: "NEW-PO" } };
    const out = shapeModifyPayload(payload, "123", "4", { CustomField: [] });
    expect(out.CustomField).toBeUndefined();
  });
});
