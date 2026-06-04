import { requireOrg, bad, ok } from "@/lib/api";
import { createPortalToken } from "@/lib/portal";

/**
 * POST /api/portal/token  (staff-authenticated)
 * Mint a single-use customer portal link so any staff send path can include
 * the "View & Respond" button consistently.
 * Body: { customerId, invoiceIds: string[] }
 */
export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  if (!body.customerId || !Array.isArray(body.invoiceIds) || body.invoiceIds.length === 0) {
    return bad("customerId and invoiceIds are required");
  }
  const userId = (session!.user as any).id as string;
  const { url } = await createPortalToken(orgId!, body.customerId, body.invoiceIds, userId);
  return ok({ url });
}
