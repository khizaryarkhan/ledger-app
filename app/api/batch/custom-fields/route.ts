/**
 * GET /api/batch/custom-fields?entity=<id>
 *
 * Discovers the org's actual custom field LABELS for an entity, by sampling
 * recent QBO records — see lib/batch/custom-fields.ts for why (no "list
 * definitions" REST endpoint). Used by the entity workspace page to show
 * what "Custom Field Value (N)" actually means before someone downloads or
 * edits the spreadsheet.
 */
import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { discoverCustomFieldLabels } from "@/lib/batch/custom-fields";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const entity = getEntity(new URL(req.url).searchParams.get("entity") || "");
  if (!entity?.qboReadName) return bad("Unknown entity", 404);

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return ok({ connected: false, fields: [] });

  const fields = await discoverCustomFieldLabels(token, entity).catch(() => []);
  return ok({ connected: true, fields });
}
