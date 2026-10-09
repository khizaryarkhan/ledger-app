/**
 * Bulk Edit's Estimate custom-field picker used to discover fields by
 * sampling the 20 most recent records — missing any field not filled on at
 * least one of them (reported: "add all Custom Fields, some weren't
 * showing"). `parseSalesCustomFieldDefs` reads them straight from QBO's
 * Preferences object instead, which is authoritative and complete.
 *
 * The fixture below is Intuit's OWN worked example from "Manage custom
 * fields (legacy)" (developer.intuit.com), not invented — including its
 * out-of-order array (UseSalesCustom3 before 1/2; SalesCustomName2 before 1)
 * and its deliberately-unset third field, which is exactly what the
 * position-matching-by-name (not array order) logic exists to handle.
 */
import { describe, it, expect } from "vitest";
import { parseSalesCustomFieldDefs } from "@/lib/batch/custom-fields";

const INTUIT_DOCS_EXAMPLE_PREFS = {
  SalesFormsPrefs: {
    CustomField: [
      {
        CustomField: [
          { Name: "SalesFormsPrefs.UseSalesCustom3", Type: "BooleanType", BooleanValue: false },
          { Name: "SalesFormsPrefs.UseSalesCustom1", Type: "BooleanType", BooleanValue: true },
          { Name: "SalesFormsPrefs.UseSalesCustom2", Type: "BooleanType", BooleanValue: true },
        ],
      },
      {
        CustomField: [
          { Name: "SalesFormsPrefs.SalesCustomName2", Type: "StringType", StringValue: "Field Two" },
          { Name: "SalesFormsPrefs.SalesCustomName1", Type: "StringType", StringValue: "Field One" },
        ],
      },
    ],
  },
};

describe("parseSalesCustomFieldDefs", () => {
  it("returns only the enabled fields, matched by position not array order", () => {
    expect(parseSalesCustomFieldDefs(INTUIT_DOCS_EXAMPLE_PREFS)).toEqual([
      { position: 1, name: "Field One", definitionId: "1" },
      { position: 2, name: "Field Two", definitionId: "2" },
    ]);
  });

  it("omits a disabled field even though it has no name entry to pair with", () => {
    const result = parseSalesCustomFieldDefs(INTUIT_DOCS_EXAMPLE_PREFS);
    expect(result.find((f) => f.position === 3)).toBeUndefined();
  });

  it("sorts by position", () => {
    const shuffled = {
      SalesFormsPrefs: {
        CustomField: [
          { CustomField: [
            { Name: "SalesFormsPrefs.UseSalesCustom2", Type: "BooleanType", BooleanValue: true },
            { Name: "SalesFormsPrefs.UseSalesCustom1", Type: "BooleanType", BooleanValue: true },
          ] },
          { CustomField: [
            { Name: "SalesFormsPrefs.SalesCustomName1", Type: "StringType", StringValue: "A" },
            { Name: "SalesFormsPrefs.SalesCustomName2", Type: "StringType", StringValue: "B" },
          ] },
        ],
      },
    };
    expect(parseSalesCustomFieldDefs(shuffled).map((f) => f.position)).toEqual([1, 2]);
  });

  it("returns an empty list when the company has no sales custom fields configured", () => {
    expect(parseSalesCustomFieldDefs({})).toEqual([]);
    expect(parseSalesCustomFieldDefs({ SalesFormsPrefs: {} })).toEqual([]);
  });

  it("DefinitionId is the position number as a string, matching what a write already sends", () => {
    const [field] = parseSalesCustomFieldDefs(INTUIT_DOCS_EXAMPLE_PREFS);
    expect(field.definitionId).toBe(String(field.position));
  });
});
