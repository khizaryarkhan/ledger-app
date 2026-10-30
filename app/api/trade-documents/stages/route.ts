/**
 * Order stages (0117): the org's own manual stages next to the workflow's own.
 *
 * GET                       → { system, custom, fulfilment }
 * POST   { label, color? }  → add a stage          (admins)
 * PATCH  { key, label }     → rename a stage       (admins)
 * DELETE { key }            → delete an unused one (admins)
 *
 * Keys are immutable and are what orders store; only the label may change.
 */
import { requireOrg, ok, bad } from "@/lib/api";
import { LedgerValidationError } from "@/lib/ledger";
import { listPoStages, createPoStage, renamePoStage, deletePoStage } from "@/lib/accounting/po-workflow-server";
import { COLOR_OPTIONS } from "@/lib/stages";

const ADMINS = ["company_admin", "super_admin"];

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  return ok(await listPoStages(orgId!));
}

async function admin(req: Request, run: (orgId: string, body: any) => Promise<unknown>) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!ADMINS.includes(role!)) return bad("Admins only", 403);
  const body = await req.json().catch(() => ({}));
  try { return ok(await run(orgId!, body)); }
  catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[trade-documents] stages failed:", e);
    return bad("Could not save the stage", 500);
  }
}

export const POST = (req: Request) => admin(req, (orgId, b) =>
  createPoStage(orgId, { label: String(b.label ?? ""), color: COLOR_OPTIONS.includes(b.color) ? b.color : "stone" }));
export const PATCH = (req: Request) => admin(req, (orgId, b) => renamePoStage(orgId, String(b.key ?? ""), String(b.label ?? "")));
export const DELETE = (req: Request) => admin(req, (orgId, b) => deletePoStage(orgId, String(b.key ?? "")));
