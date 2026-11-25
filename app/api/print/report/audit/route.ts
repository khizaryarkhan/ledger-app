/**
 * POST /api/print/report/audit   body: { title, format: "xlsx" | "print", rows }
 *
 * Excel and Print are produced in the browser, so the server never sees them.
 * This records that the data left the system, the same way the PDF route does.
 * Fire-and-forget from the client; it carries no report data, only the title,
 * the format and a row count.
 */
import { z } from "zod";
import { bad, ok, requireOrg } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { isAiCall, sameOrigin, userIdOf } from "@/lib/pax/http";

export const runtime = "nodejs";

const Body = z.object({
  title: z.string().min(1).max(200),
  format: z.enum(["xlsx", "print"]),
  rows: z.number().int().min(0).max(50_000), // the Excel row cap
});

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  if (isAiCall(session)) return bad("Not available to AI connections.", 403);
  if (!sameOrigin(req)) return bad("Cross-origin request refused", 403);

  const limited = await rateLimit(`report-audit:${userIdOf(session)}`, 60, 60);
  if (!limited.ok) return bad("Too many requests", 429);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad("Invalid request");

  await logEvent({
    orgId: orgId!, eventType: "report_exported",
    actorId: (session?.user as any)?.id ?? null, actorName: (session?.user as any)?.name ?? null,
    // Excel and Print happen in the browser, so this row is the user's own report of it, not a server-side fact.
    meta: { report: parsed.data.title, format: parsed.data.format, rows: parsed.data.rows, selfReported: true },
  });
  return ok({ ok: true });
}
