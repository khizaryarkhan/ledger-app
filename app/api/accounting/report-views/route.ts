/**
 * GET    /api/accounting/report-views?reportKey=…  -> the caller's own saved views for one report
 * POST   /api/accounting/report-views { reportKey, name, params } -> { id }  (same name = replace that view)
 * DELETE /api/accounting/report-views?id=…         -> removes one of the caller's own views
 *
 * A view is PERSONAL: every query is scoped to the signed-in org AND user, so nobody can read, replace or
 * delete another person's. It stores settings only (period, columns, compare-to), never figures.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { reportViews } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { MAX_VIEWS_PER_REPORT, isReportKey, parseViewInput } from "@/lib/reports/saved-views";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function who() {
  const r = await requireOrg();
  if (r.error) return { error: r.error };
  const userId = (r.session?.user as any)?.id as string | undefined;
  if (!userId) return { error: bad("Sign in again to use saved views", 401) };
  return { orgId: r.orgId!, userId };
}

export async function GET(req: Request) {
  const w = await who();
  if ("error" in w) return w.error;
  const reportKey = new URL(req.url).searchParams.get("reportKey");
  if (!isReportKey(reportKey)) return bad("Unknown report.");
  const rows = await db.select({ id: reportViews.id, name: reportViews.name, params: reportViews.params })
    .from(reportViews)
    .where(and(eq(reportViews.orgId, w.orgId), eq(reportViews.userId, w.userId), eq(reportViews.reportKey, reportKey)))
    .orderBy(asc(sql`lower(${reportViews.name})`));
  return ok({ views: rows });
}

export async function POST(req: Request) {
  const w = await who();
  if ("error" in w) return w.error;
  const parsed = parseViewInput(await req.json().catch(() => ({})));
  if (parsed.ok === false) return bad(parsed.error);
  const { reportKey, name, params } = parsed.value;

  const mine = and(eq(reportViews.orgId, w.orgId), eq(reportViews.userId, w.userId), eq(reportViews.reportKey, reportKey));
  const existing = await db.select({ id: reportViews.id, name: reportViews.name }).from(reportViews).where(mine);
  const same = existing.find((v) => v.name.toLowerCase() === name.toLowerCase());
  if (same) {
    await db.update(reportViews).set({ name, params, updatedAt: new Date() })
      .where(and(eq(reportViews.id, same.id), eq(reportViews.orgId, w.orgId), eq(reportViews.userId, w.userId)));
    return ok({ id: same.id, replaced: true });
  }
  if (existing.length >= MAX_VIEWS_PER_REPORT) return bad(`You can keep ${MAX_VIEWS_PER_REPORT} saved views per report. Delete one first.`);
  try {
    const [row] = await db.insert(reportViews).values({ orgId: w.orgId, userId: w.userId, reportKey, name, params }).returning({ id: reportViews.id });
    return ok({ id: row.id, replaced: false });
  } catch (e: any) {
    // Two saves of one name at once: the unique index decides, and the loser is told rather than left with a 500.
    if (e?.code === "23505") return bad("A view with that name already exists. Try again.", 409);
    throw e;
  }
}

export async function DELETE(req: Request) {
  const w = await who();
  if ("error" in w) return w.error;
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !UUID.test(id)) return bad("Unknown view.");
  const gone = await db.delete(reportViews)
    .where(and(eq(reportViews.id, id), eq(reportViews.orgId, w.orgId), eq(reportViews.userId, w.userId)))
    .returning({ id: reportViews.id });
  if (gone.length === 0) return bad("That view no longer exists.", 404);
  return ok({ ok: true });
}
