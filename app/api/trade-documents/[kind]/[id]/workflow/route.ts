/**
 * Purchase / sales order workflow actions (0117).
 *
 * GET  ?view=items&today=YYYY-MM-DD → the order's lines: ordered, received, balance, pack, dates
 * GET  ?view=proposal              → the supplier's pending proposal (null when none)
 * POST { action: "stage", stage }  → manual stage, or null to derive again
 *      { action: "reject", reason } / { action: "reopen" }
 *      { action: "decide", responseId, accept: { [lineId]: boolean }, reply? }
 *
 * None of these moves stock or money directly — like recording a confirmation,
 * any company user may use them. Accepting a proposal re-prices the order's own
 * lines; nothing is posted until goods are received or a bill is raised.
 */
import { requireOrg, ok, bad } from "@/lib/api";
import { LedgerValidationError } from "@/lib/ledger";
import { poItems, setPoStage, rejectPo, reopenPo } from "@/lib/accounting/po-workflow-server";
import { pendingProposal, decideProposal } from "@/lib/accounting/po-supplier-server";
import { today as utcToday } from "@/lib/format";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request, { params }: { params: { kind: string; id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const url = new URL(req.url);
  const view = url.searchParams.get("view");
  if (view === "proposal") return ok(await pendingProposal(orgId!, params.id));
  const day = url.searchParams.get("today");
  return ok(await poItems(orgId!, params.id, day && DATE_RE.test(day) ? day : utcToday()));
}

export async function POST(req: Request, { params }: { params: { kind: string; id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  if (params.kind !== "purchase-orders") return bad("Only purchase orders have this workflow.", 404);
  const actor = (session?.user as any)?.id ?? null;
  const b = await req.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "stage":
        return ok(await setPoStage(orgId!, params.id, typeof b.stage === "string" && b.stage ? b.stage : null, actor));
      case "reject":
        return ok(await rejectPo(orgId!, params.id, String(b.reason ?? ""), actor));
      case "reopen":
        return ok(await reopenPo(orgId!, params.id, actor));
      case "decide": {
        const accept: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(b.accept ?? {})) accept[k] = v === true;
        return ok(await decideProposal(orgId!, params.id, { responseId: String(b.responseId ?? ""), accept, reply: typeof b.reply === "string" ? b.reply : null }, actor));
      }
      default:
        return bad("Unknown action.");
    }
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[trade-documents] workflow failed:", e);
    return bad("Could not save that change", 500);
  }
}
