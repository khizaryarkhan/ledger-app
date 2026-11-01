/**
 * GET   /api/accounting/fixed-assets/[id]  -> asset + full schedule (posted flags)
 * PATCH /api/accounting/fixed-assets/[id]  -> { name?, notes? } or { dispose: { date } } (admins)
 *
 * Disposal records the date and stops depreciation from that month on. It
 * posts nothing - the sale / write-off entry is the user's own journal.
 */

import { db } from "@/db";
import { fixedAssets } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { scheduleFor, fullSchedule, periodOf } from "@/lib/accounting/fixed-assets";
import { postedPeriodsByAsset, toTerms } from "@/lib/accounting/fixed-assets-server";

const ADMIN = ["company_admin", "super_admin"];
const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function load(orgId: string, id: string) {
  const [a] = await db.select().from(fixedAssets)
    .where(and(eq(fixedAssets.id, id), eq(fixedAssets.orgId, orgId))).limit(1);
  return a;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const a = await load(orgId!, params.id);
  if (!a) return bad("Asset not found", 404);
  const posted = (await postedPeriodsByAsset(orgId!, [a.id])).get(a.id) ?? new Map<string, number>();
  const active = new Set(scheduleFor(toTerms(a)).map(r => r.period));
  const schedule = fullSchedule(toTerms(a)).map(r => ({
    ...r, posted: posted.has(r.period), cancelled: !active.has(r.period),
  }));
  return ok({ asset: a, schedule });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!ADMIN.includes(role!)) return bad("Admins only", 403);
  const a = await load(orgId!, params.id);
  if (!a) return bad("Asset not found", 404);
  const b = await req.json().catch(() => ({}));

  if (b?.dispose) {
    if (a.status === "disposed") return bad("This asset is already disposed.");
    const date = b.dispose?.date;
    if (!isYmd(date)) return bad("Disposal date must be YYYY-MM-DD.");
    if (periodOf(date) < periodOf(a.purchaseDate)) return bad("Disposal cannot be before the purchase month.");
    // Months already charged must not fall on/after the disposal month.
    const posted = (await postedPeriodsByAsset(orgId!, [a.id])).get(a.id) ?? new Map<string, number>();
    const late = [...posted.keys()].filter(p => p >= periodOf(date)).sort();
    if (late.length) return bad(`Depreciation is already posted for ${late[0]}, which is on or after the disposal month. Choose a later date.`);
    await db.update(fixedAssets).set({ status: "disposed", disposedDate: date }).where(eq(fixedAssets.id, a.id));
    return ok({ ok: true });
  }

  const patch: { name?: string; notes?: string | null } = {};
  if (typeof b?.name === "string") {
    const n = b.name.trim();
    if (!n || n.length > 160) return bad("Name is required (160 characters max).");
    patch.name = n;
  }
  if (typeof b?.notes === "string") patch.notes = b.notes.trim() || null;
  if (!Object.keys(patch).length) return bad("Nothing to change.");
  await db.update(fixedAssets).set(patch).where(eq(fixedAssets.id, a.id));
  return ok({ ok: true });
}
