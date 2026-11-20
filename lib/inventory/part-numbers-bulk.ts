/**
 * A customer's part-number list pasted from a spreadsheet: one line per item,
 * "our item or SKU, their part number[, level]". Pure parsing only; matching to
 * items is in part-numbers-bulk-server.ts. Never guesses: a line it cannot read
 * is reported with its line number and nothing else on the list is affected.
 *
 * Separators: tab (a spreadsheet copy), semicolon or comma. A comma only splits
 * when there is no tab, so an item name such as "Salt, fine" survives a tab list.
 */

import { PART_NUMBER_MAX } from "@/lib/inventory/part-numbers";

export const BULK_LEVELS = ["unit", "inner", "addl_inner", "outer"] as const;
export type BulkLevel = typeof BULK_LEVELS[number];
export const BULK_MAX_ROWS = 2000;

export type BulkRow = { line: number; ref: string; code: string; level: BulkLevel };
export type BulkProblem = { line: number; message: string };

const LEVEL_WORDS: Record<string, BulkLevel> = {
  unit: "unit", base: "unit", each: "unit", inner: "inner", "inner pack": "inner",
  "addl inner": "addl_inner", addl_inner: "addl_inner", "additional inner": "addl_inner", outer: "outer", "outer pack": "outer", carton: "outer", case: "outer",
};

function cells(line: string): string[] {
  const sep = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
  const out: string[] = []; let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') { q = !q; continue; }
    if (ch === sep && !q) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const looksLikeHeader = (c: string[]) => /^(item|sku|product|name|our)/i.test(c[0] ?? "") && /(part|code|number|their|customer)/i.test(c[1] ?? "");

export function parsePartList(text: string): { rows: BulkRow[]; problems: BulkProblem[] } {
  const rows: BulkRow[] = [], problems: BulkProblem[] = [];
  const lines = String(text ?? "").split(/\r?\n/);
  let first = true;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const c = cells(raw);
    if (first) { first = false; if (looksLikeHeader(c)) continue; }
    const n = i + 1;
    if (rows.length >= BULK_MAX_ROWS) { problems.push({ line: n, message: `Only the first ${BULK_MAX_ROWS} lines are read at once. Split the list.` }); break; }
    const [ref, code, lv] = c;
    if (!ref) { problems.push({ line: n, message: "No item or SKU named." }); continue; }
    if (!code) { problems.push({ line: n, message: `No part number for "${ref}".` }); continue; }
    if (code.length > PART_NUMBER_MAX) { problems.push({ line: n, message: `The part number for "${ref}" is longer than ${PART_NUMBER_MAX} characters.` }); continue; }
    let level: BulkLevel = "unit";
    if (lv) {
      const l = LEVEL_WORDS[lv.trim().toLowerCase()];
      if (!l) { problems.push({ line: n, message: `Unknown level "${lv}". Use unit, inner, addl inner or outer.` }); continue; }
      level = l;
    }
    rows.push({ line: n, ref, code, level });
  }
  return { rows, problems };
}
