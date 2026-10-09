/**
 * Discover an entity's custom field LABELS by sampling recent QBO records —
 * there is no "list custom field definitions" REST endpoint. (That's the
 * newer GraphQL "App Foundations" platform, gated behind Intuit's Silver+
 * partner tier; see CLAUDE.md's "Projects & custom fields" section.)
 *
 * Position is read off the SINGLE sampled record with the most custom
 * fields set, not a union across records (bulk-edit/meta's cfMap does that,
 * for a different purpose — picking one field by DefinitionId to set on
 * many records, where union order doesn't matter). Here it does: "position
 * 1/2/3" must match exactly what the spreadsheet's "Custom Field Value (N)"
 * column edits via shapeModifyPayload's positional splice, and that splice
 * reads position off ONE record's own CustomField array — mixing fields
 * from two differently-ordered records would report a position that no
 * single real record actually has.
 */
import type { OrgQboToken } from "@/lib/qbo-token";
import type { BatchEntity } from "./types";
import { qboQueryTop, qboQueryAll } from "./qbo-client";

export interface DiscoveredCustomField {
  position: number;      // 1-based — matches "Custom Field Value (N)"
  name: string;
  definitionId: string;
}

export async function discoverCustomFieldLabels(
  token: OrgQboToken,
  entity: BatchEntity,
): Promise<DiscoveredCustomField[]> {
  if (!entity.qboReadName) return [];

  const records = entity.qboClientFilter
    ? (await qboQueryTop(token, entity.qboReadName, 50, "")).filter(entity.qboClientFilter).slice(0, 20)
    : await qboQueryTop(token, entity.qboReadName, 20, entity.qboExtraWhere || "");

  let best: any[] = [];
  for (const r of records) {
    const cf = Array.isArray(r.CustomField) ? r.CustomField : [];
    if (cf.length > best.length) best = cf;
  }

  return best
    .map((cf, i) => ({ position: i + 1, name: String(cf?.Name ?? ""), definitionId: String(cf?.DefinitionId ?? "") }))
    .filter((f) => f.name && f.definitionId);
}

/**
 * ALL of the company's enabled custom field definitions for sales
 * transactions (Invoice/Estimate/SalesReceipt/CreditMemo/RefundReceipt) —
 * read directly from QBO's `Preferences` object, not sampled from recent
 * transactions. `discoverCustomFieldLabels` above samples records, which
 * misses any field that isn't filled on at least one of the last ~20 docs —
 * exactly the reported gap ("add all Custom Fields" to the Bulk Edit picker,
 * some weren't showing).
 *
 * Confirmed against Intuit's own "Manage custom fields (legacy)" docs, not
 * guessed: `Preferences.SalesFormsPrefs.CustomField` is TWO sub-arrays — one
 * of `{Name: "SalesFormsPrefs.UseSalesCustom<N>", BooleanValue}` enabled
 * flags, one of `{Name: "SalesFormsPrefs.SalesCustomName<N>", StringValue}`
 * labels — matched here by the trailing `<N>` (1-3), NOT by array order
 * (Intuit's docs warn the two sub-arrays aren't guaranteed to come back in
 * the same order). `DefinitionId` for this classic system IS the position
 * number `<N>` — confirmed by Intuit's own docs ("CustomField.DefinitionId:
 * Numeric portion from Preferences.SalesFormsPrefs.CustomField.CustomField.
 * Name"), matching what's already sent when writing a CustomField value
 * (`DefinitionId: "1"`).
 */
/**
 * Pure parsing core — no I/O — so the position-matching logic is provable
 * directly against the exact shape Intuit's docs show, rather than only
 * against a live QBO connection.
 */
export function parseSalesCustomFieldDefs(prefs: any): DiscoveredCustomField[] {
  const groups: any[] = prefs?.SalesFormsPrefs?.CustomField ?? [];

  const enabled = new Map<number, boolean>();
  const names = new Map<number, string>();
  for (const group of groups) {
    for (const cf of (group?.CustomField ?? [])) {
      const m = /^SalesFormsPrefs\.(UseSalesCustom|SalesCustomName)(\d)$/.exec(String(cf?.Name ?? ""));
      if (!m) continue;
      const position = Number(m[2]);
      if (m[1] === "UseSalesCustom") enabled.set(position, !!cf.BooleanValue);
      else names.set(position, String(cf.StringValue ?? "").trim());
    }
  }

  const out: DiscoveredCustomField[] = [];
  for (const [position, isOn] of enabled) {
    if (!isOn) continue;
    const name = names.get(position);
    if (name) out.push({ position, name, definitionId: String(position) });
  }
  return out.sort((a, b) => a.position - b.position);
}

export async function discoverSalesCustomFieldDefs(token: OrgQboToken): Promise<DiscoveredCustomField[]> {
  const prefs = (await qboQueryAll(token, "Preferences"))[0];
  return parseSalesCustomFieldDefs(prefs);
}
