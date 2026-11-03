// Paging and field selection for what an AI connection reads. Pure — no db.
//
// Most app routes return every row (they were written for screens that render
// everything), so an AI asking for invoices got 100k characters and then
// "response truncated". Changing ~500 routes to page would take months; shaping
// the response here gives every route paging at once. The route still does the
// full query — this saves the model's context, not the database.

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;

export type ShapeOpts = { limit?: number; offset?: number; fields?: string[] };
export type Page = { path: string; total: number; offset: number; returned: number; nextOffset: number | null };

/** Validate the tool's limit / offset / fields arguments. */
export function parseShapeArgs(args: Record<string, unknown>): { ok: true; opts: ShapeOpts } | { ok: false; error: string } {
  const opts: ShapeOpts = {};
  if (args.limit !== undefined) {
    const n = Number(args.limit);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) return { ok: false, error: `limit must be a whole number from 1 to ${MAX_LIMIT}` };
    opts.limit = n;
  }
  if (args.offset !== undefined) {
    const n = Number(args.offset);
    if (!Number.isInteger(n) || n < 0) return { ok: false, error: "offset must be a whole number of 0 or more" };
    opts.offset = n;
  }
  if (args.fields !== undefined) {
    const list = Array.isArray(args.fields) ? args.fields : String(args.fields).split(",");
    const clean = list.map((f) => String(f).trim()).filter(Boolean);
    if (clean.length === 0 || clean.length > 50) return { ok: false, error: "fields must name between 1 and 50 fields" };
    opts.fields = clean;
  }
  return { ok: true, opts };
}

type Found = { path: string; list: unknown[]; set(next: unknown[]): unknown };

/**
 * The response's main list: the body itself if it is an array, otherwise its
 * largest array one or two levels down (`{ invoices: [...] }`, `{ data: { rows: [...] } }`).
 * Picking the largest, not the first, is what finds the rows rather than a short
 * list of currencies or filters that some routes return beside them.
 */
function findList(value: unknown): Found | null {
  if (Array.isArray(value)) return { path: "$", list: value, set: (next) => next };
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  let best: Found | null = null;
  for (const [k, v] of Object.entries(root)) {
    if (Array.isArray(v)) {
      if (!best || v.length > best.list.length) best = { path: k, list: v, set: (next) => ({ ...root, [k]: next }) };
    } else if (v && typeof v === "object") {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (Array.isArray(v2) && (!best || v2.length > best.list.length)) {
          best = { path: `${k}.${k2}`, list: v2, set: (next) => ({ ...root, [k]: { ...(v as object), [k2]: next } }) };
        }
      }
    }
  }
  return best;
}

function project(item: unknown, fields: string[]): unknown {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const o = item as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) if (f in o) out[f] = o[f];
  return out;
}

/**
 * Apply paging and field selection. A list is paged only when the caller asked
 * or it is longer than DEFAULT_LIMIT, so a short answer comes back unchanged.
 * `page` tells the model what it is looking at and how to get the rest.
 */
export function shapeJson(value: unknown, opts: ShapeOpts): { value: unknown; page: Page | null } {
  const found = findList(value);
  if (!found) return { value, page: null };
  const total = found.list.length;
  const asked = opts.limit !== undefined || opts.offset !== undefined;
  if (!asked && !opts.fields && total <= DEFAULT_LIMIT) return { value, page: null };

  const offset = Math.min(opts.offset ?? 0, total);
  const limit = opts.limit ?? DEFAULT_LIMIT;
  let slice = found.list.slice(offset, offset + limit);
  if (opts.fields) slice = slice.map((i) => project(i, opts.fields!));
  const end = offset + slice.length;
  return {
    value: found.set(slice),
    page: { path: found.path, total, offset, returned: slice.length, nextOffset: end < total ? end : null },
  };
}

export function describePage(p: Page): string {
  const where = p.path === "$" ? "the list" : `"${p.path}"`;
  if (p.returned === 0) return `[${where} has ${p.total} row(s); none at offset ${p.offset}]`;
  const range = `rows ${p.offset + 1}–${p.offset + p.returned} of ${p.total} in ${where}`;
  return p.nextOffset === null ? `[${range}]` : `[${range} — call again with offset ${p.nextOffset} for more]`;
}
