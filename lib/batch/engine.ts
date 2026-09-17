/**
 * Batch engine — file parsing, column auto-mapping, and row grouping.
 *
 * All header keys are trimmed on parse so the builders can rely on canonical
 * (whitespace-free) column names regardless of how the uploaded file was saved.
 */

import * as XLSX from "xlsx";
import type { BatchEntity, SheetRow, GroupedDoc } from "./types";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const canon = (s: string) => s.trim();

export interface ParsedFile {
  headers: string[];       // trimmed file headers, in order
  rows: SheetRow[];        // rows keyed by trimmed file header
}

/**
 * Parse an uploaded xlsx/csv into headers + rows (first sheet). Isomorphic:
 * accepts a Node Buffer (server) or an ArrayBuffer/Uint8Array (browser), so the
 * client can parse the file locally and POST rows as JSON — avoiding the
 * platform's ~4.5 MB multipart request-body limit on serverless functions.
 */
export function parseWorkbook(data: Buffer | ArrayBuffer | Uint8Array): ParsedFile {
  let readArg: any = data;
  let type: "buffer" | "array" = "buffer";
  if (data instanceof ArrayBuffer) { readArg = new Uint8Array(data); type = "array"; }
  else if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) { type = "buffer"; }
  else if (data instanceof Uint8Array) { type = "array"; }
  // cellDates:false — do NOT let SheetJS build JS Date objects. A Date is
  // created at local midnight and, once serialised to JSON (toISOString/UTC),
  // shifts a day in positive-offset timezones (UTC+5: 1 Jul → 30 Jun). Instead
  // we keep the raw Excel serial number and convert it with pure UTC integer
  // math downstream (lib/batch/dates), so the calendar day is exact everywhere.
  const wb = XLSX.read(readArg, { type, cellDates: false });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return { headers: [], rows: [] };

  const matrix: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: true });
  if (matrix.length === 0) return { headers: [], rows: [] };

  const headers = (matrix[0] as any[]).map((h) => canon(String(h ?? "")));
  const rows: SheetRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const arr = matrix[i] as any[];
    if (!arr || arr.every((c) => c == null || c === "")) continue;
    const row: SheetRow = {};
    headers.forEach((h, idx) => {
      if (h) row[h] = cellValue(arr[idx]);
    });
    rows.push(row);
  }
  return { headers, rows };
}

/**
 * SheetJS builds date cells as a Date at LOCAL midnight of the intended
 * calendar day. If such a Date is JSON-serialised it becomes toISOString()
 * (UTC), which shifts the day back in positive-offset timezones (e.g. UTC+5:
 * 1 Jul → 30 Jun). So collapse date cells to a YYYY-MM-DD string here — using
 * LOCAL getters, which match how the Date was constructed — before it can be
 * transported. Non-date cells pass through untouched.
 */
function cellValue(cell: any): any {
  if (cell instanceof Date && !isNaN(cell.getTime())) {
    const y = cell.getFullYear(), m = cell.getMonth() + 1, d = cell.getDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return cell;
}

/**
 * Auto-map file headers to an entity's template columns.
 * Returns { [canonicalEntityColumn]: fileHeader } for confident matches.
 */
export function autoMap(fileHeaders: string[], entity: { columns: string[] }): Record<string, string> {
  const byNorm = new Map(fileHeaders.map((h) => [norm(h), h]));
  const mapping: Record<string, string> = {};
  for (const col of entity.columns) {
    const c = canon(col);
    const hit = byNorm.get(norm(c));
    if (hit) mapping[c] = hit;
  }
  return mapping;
}

/**
 * Re-key raw file rows into canonical entity-column rows using the mapping.
 * mapping: { canonicalEntityColumn: fileHeader }
 */
export function normalizeRows(rows: SheetRow[], mapping: Record<string, string>): SheetRow[] {
  const pairs = Object.entries(mapping);
  return rows.map((raw) => {
    const out: SheetRow = {};
    for (const [entityCol, fileHeader] of pairs) {
      out[entityCol] = raw[fileHeader];
    }
    return out;
  });
}

/**
 * Update operations need the record's identity columns (Id / SyncToken). Those
 * are added to the "download to edit" export by the row-mappers, but they are
 * NOT part of an entity's data columns, so the auto-mapping drops them — which
 * left every update failing with "Update needs an 'Id' column". Merge them back
 * into the mapping (matching common header spellings) so normalizeRows keeps
 * them. Only call this for modify — a create must never carry an Id.
 */
export function ensureIdentityMapping(
  mapping: Record<string, string>,
  sampleRow: SheetRow,
): Record<string, string> {
  const identity: Record<string, RegExp> = {
    Id: /^(id|qbo id)$/i,
    SyncToken: /^(sync ?token)$/i,
  };
  const out = { ...mapping };
  const headers = Object.keys(sampleRow || {});
  for (const [target, re] of Object.entries(identity)) {
    if (out[target]) continue; // already mapped
    const hit = headers.find((h) => re.test(String(h).trim()));
    if (hit) out[target] = hit;
  }
  return out;
}

/**
 * Group normalized rows into logical documents.
 *
 * Flat entities (lists, single-line txns) treat every row as its own document.
 * Line-item entities group rows belonging to the same document together.
 *
 * ── WHAT MAKES TWO ROWS THE SAME DOCUMENT ───────────────────────────────────
 *
 * On an UPDATE it is QuickBooks' own record id, and nothing else. The download
 * stamps `Id` on every row (see row-mappers), and `ensureIdentityMapping` keeps
 * it through normalisation, so on a modify we always have it. A create never
 * carries an Id, so that path is untouched by this and still groups on docKey.
 *
 * This used to group on docKey (e.g. "Ref No") for updates too, and that
 * DESTROYED DATA on a customer's books. DocNumber is optional on a QBO Purchase
 * and blank on most card spend, and blanks were given a unique key PER ROW:
 *
 *     one expense, Id 247, 3 lines, no Ref No
 *       -> 3 separate "documents", every one of them carrying Id 247
 *       -> 3 separate NON-SPARSE updates to the same record
 *       -> a non-sparse update replaces the whole Line array, so each write
 *          wiped the previous one. Last line wins; the other two are gone.
 *
 * The customer downloaded Expenses, added a Class, re-uploaded, and watched
 * lines disappear. It looked random because it only hit rows with a blank
 * Ref No — the more lines an expense had, the more of it was destroyed.
 *
 * The mirror-image failure was just as real: two DIFFERENT expenses that happen
 * to share a Ref No (QBO does not enforce uniqueness on Purchase.DocNumber)
 * merged into one document, and commitOneDoc takes the id from rows[0] — so one
 * record was overwritten with both records' lines and the other silently skipped.
 *
 * Grouping on the id removes both failures at once, because the id is the thing
 * the update actually writes to. Never reintroduce a heuristic here: if two rows
 * name the same record, they ARE the same document, whatever else differs.
 */
export function groupDocs(rows: SheetRow[], entity: { docKey?: string }): GroupedDoc[] {
  const key = entity.docKey ? canon(entity.docKey) : null;

  // An Id on the rows means these came from a download and are being written
  // back — group on it in preference to anything else. Checked across all rows,
  // not just the first, because a partially-filled sheet must not silently fall
  // back to the docKey path for the rows that do have one.
  const hasId = rows.some((r) => {
    const v = r["Id"] ?? r["QBO Id"];
    return v != null && String(v).trim() !== "";
  });

  if (!key && !hasId) {
    return rows.map((r, i) => ({ key: String(i), rows: [r] }));
  }

  const docs: GroupedDoc[] = [];
  const byKey = new Map<string, GroupedDoc>();
  let blankCounter = 0;

  for (const row of rows) {
    const id = row["Id"] ?? row["QBO Id"];
    const idStr = id == null ? "" : String(id).trim();

    let k: string;
    if (hasId && idStr !== "") {
      k = `__id_${idStr}`;
    } else if (key) {
      const raw = row[key];
      // A blank docKey still means "I cannot tell what this belongs to", so it
      // stays its own document rather than being merged with other blanks.
      k = raw == null || String(raw).trim() === "" ? `__blank_${blankCounter++}` : String(raw).trim();
    } else {
      k = `__row_${blankCounter++}`;
    }

    let doc = byKey.get(k);
    if (!doc) {
      doc = { key: k, rows: [] };
      byKey.set(k, doc);
      docs.push(doc);
    }
    doc.rows.push(row);
  }
  return docs;
}

/** Count how many logical documents a set of normalized rows represents. */
export function countDocs(rows: SheetRow[], entity: { docKey?: string }): number {
  return groupDocs(rows, entity).length;
}
