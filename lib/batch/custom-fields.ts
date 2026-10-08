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
import { qboQueryTop } from "./qbo-client";

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
