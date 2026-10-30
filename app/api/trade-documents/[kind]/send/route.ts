/**
 * Send purchase orders to the supplier from the user's connected mailbox.
 *
 * GET  ?ids=a,b → recipient / subject / message defaults for the Send drawer
 * POST { ids, to, cc?, subject, body } → email a PDF per order plus a private
 *      supplier-portal link per order, and move each from Created to Sent.
 *
 * Rendering the PDFs uses headless Chromium, which cannot run on the Edge runtime.
 */
import { requireOrg, ok, bad } from "@/lib/api";
import { LedgerValidationError } from "@/lib/ledger";
import { sendPurchaseOrders, sendDefaults } from "@/lib/accounting/po-supplier-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noBreaks = (s: unknown) => typeof s === "string" && !/[\r\n]/.test(s);

export async function GET(req: Request, { params }: { params: { kind: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  if (params.kind !== "purchase-orders") return bad("Only purchase orders are sent to a supplier.", 404);
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(x => UUID_RE.test(x));
  if (!ids.length) return bad("Choose at least one purchase order.");
  try { return ok(await sendDefaults(orgId!, ids)); }
  catch (e: any) { return e instanceof LedgerValidationError ? bad(e.message) : bad("Could not load the email", 500); }
}

export async function POST(req: Request, { params }: { params: { kind: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  if (params.kind !== "purchase-orders") return bad("Only purchase orders are sent to a supplier.", 404);
  const b = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === "string" && UUID_RE.test(x)) : [];
  // CRLF in a header field is an injection vector — refuse it, as /api/email/send does.
  if (!noBreaks(b.to) || !noBreaks(b.subject) || (b.cc != null && !noBreaks(b.cc))) return bad("Recipients and subject must not contain line breaks.");
  if (typeof b.body !== "string" || !b.body.trim() || b.body.length > 200_000) return bad("Write a message.");
  try {
    return ok(await sendPurchaseOrders(orgId!, { ids, to: b.to, cc: b.cc || undefined, subject: b.subject, body: b.body },
      (session?.user as any)?.id ?? null, (session?.user as any)?.name ?? null));
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[trade-documents] send failed:", e);
    return bad(e?.message || "Could not send the email", 500);
  }
}
