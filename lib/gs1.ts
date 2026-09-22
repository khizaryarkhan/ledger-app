/**
 * GS1 — GTIN validation and GS1-128 element strings. Pure: no db, no network,
 * safe on the client and in the mobile app, so the same rules hold wherever a
 * barcode is typed, printed or scanned.
 *
 * Two jobs, one module, because they must agree:
 *   - WRITING: `buildGs1()` produces what a GS1-128 label encodes, so we can
 *     print compliant carton / pallet labels from a lot.
 *   - READING: `parseGs1()` turns a scan (a supplier's label, or ours) back into
 *     GTIN + batch + dates, so receiving can be filled in from the camera.
 * A label we print must parse back to exactly what we put in it; the tests pin
 * that round trip.
 *
 * Scope is the Application Identifiers a trade item / logistic unit label
 * actually carries. Unknown AIs are reported, not guessed at: a parser that
 * silently skips what it doesn't know can mis-split every field after it.
 */

// ─────────────────────────────────────────────────────────────────────────────
// GTIN
// ─────────────────────────────────────────────────────────────────────────────

/** Mod-10 check digit over the digits BEFORE the check digit (GS1 General Specifications §7.9). */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  // Weights alternate 3,1,3,1… counted from the RIGHT of the body.
  for (let i = 0; i < body.length; i++) {
    const d = body.charCodeAt(body.length - 1 - i) - 48;
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export type GtinResult =
  | { ok: true; gtin14: string; format: "GTIN-8" | "GTIN-12" | "GTIN-13" | "GTIN-14" }
  | { ok: false; error: string };

/**
 * Validate a GTIN as typed or scanned and normalise it to 14 digits.
 * GTIN-8 (EAN-8), GTIN-12 (UPC-A), GTIN-13 (EAN-13) and GTIN-14 (ITF-14 / case)
 * are the same number space left-padded with zeros, so storing all of them as
 * GTIN-14 is what makes "00012345678905" and "012345678905" the same item.
 */
export function normaliseGtin(input: string | null | undefined): GtinResult {
  const raw = String(input ?? "").replace(/[\s-]/g, "");
  if (!raw) return { ok: false, error: "Enter a GTIN." };
  if (!/^\d+$/.test(raw)) return { ok: false, error: "A GTIN is digits only." };
  const fmt = ({ 8: "GTIN-8", 12: "GTIN-12", 13: "GTIN-13", 14: "GTIN-14" } as const)[raw.length as 8 | 12 | 13 | 14];
  if (!fmt) return { ok: false, error: `A GTIN has 8, 12, 13 or 14 digits — this has ${raw.length}.` };
  const expected = gs1CheckDigit(raw.slice(0, -1));
  if (expected !== Number(raw.slice(-1))) {
    return { ok: false, error: `Check digit should be ${expected}, not ${raw.slice(-1)} — the number was probably mistyped.` };
  }
  return { ok: true, gtin14: raw.padStart(14, "0"), format: fmt };
}

/** Shortest standard form for display: a GTIN-14 that is really a GTIN-13/12/8 prints as that. */
export function displayGtin(gtin14: string): string {
  if (gtin14.startsWith("000000")) return gtin14.slice(6);           // GTIN-8
  if (gtin14.startsWith("00")) return gtin14.slice(2);               // GTIN-12 (UPC-A)
  if (gtin14.startsWith("0")) return gtin14.slice(1);                // GTIN-13 (EAN-13)
  return gtin14;
}

// ─────────────────────────────────────────────────────────────────────────────
// Application Identifiers
// ─────────────────────────────────────────────────────────────────────────────

type AiDef = { ai: string; label: string; fixed?: number; max?: number; kind: "numeric" | "alnum" | "date" | "decimal" };

/**
 * Trade-item and logistic-unit AIs. `fixed` = exact data length (no separator
 * needed after it); otherwise variable up to `max` and terminated by FNC1/GS
 * unless it is last. 310n–369n carry the decimal places in the AI's 4th digit.
 */
const AIS: AiDef[] = [
  { ai: "00", label: "SSCC",                    fixed: 18, kind: "numeric" },
  { ai: "01", label: "GTIN",                    fixed: 14, kind: "numeric" },
  { ai: "02", label: "Content GTIN",            fixed: 14, kind: "numeric" },
  { ai: "10", label: "Batch / lot",             max: 20,   kind: "alnum" },
  { ai: "11", label: "Production date",         fixed: 6,  kind: "date" },
  { ai: "12", label: "Due date",                fixed: 6,  kind: "date" },
  { ai: "13", label: "Packaging date",          fixed: 6,  kind: "date" },
  { ai: "15", label: "Best before",             fixed: 6,  kind: "date" },
  { ai: "16", label: "Sell by",                 fixed: 6,  kind: "date" },
  { ai: "17", label: "Expiry",                  fixed: 6,  kind: "date" },
  { ai: "20", label: "Variant",                 fixed: 2,  kind: "numeric" },
  { ai: "21", label: "Serial number",           max: 20,   kind: "alnum" },
  { ai: "30", label: "Variable count",          max: 8,    kind: "numeric" },
  { ai: "37", label: "Count of trade items",    max: 8,    kind: "numeric" },
  { ai: "400", label: "Customer PO number",     max: 30,   kind: "alnum" },
  { ai: "410", label: "Ship-to GLN",            fixed: 13, kind: "numeric" },
  { ai: "414", label: "Location GLN",           fixed: 13, kind: "numeric" },
  { ai: "420", label: "Ship-to postal code",    max: 20,   kind: "alnum" },
  { ai: "422", label: "Country of origin",      fixed: 3,  kind: "numeric" },
  // Measures: the 4th digit is the number of decimals (3102 = kg with 2dp).
  { ai: "310", label: "Net weight (kg)",        fixed: 6,  kind: "decimal" },
  { ai: "311", label: "Length (m)",             fixed: 6,  kind: "decimal" },
  { ai: "315", label: "Net volume (l)",         fixed: 6,  kind: "decimal" },
  { ai: "330", label: "Gross weight (kg)",      fixed: 6,  kind: "decimal" },
];
const DECIMAL_PREFIXES = new Set(AIS.filter(a => a.kind === "decimal").map(a => a.ai));

/** Group separator — what FNC1 transmits inside a GS1-128 / DataMatrix symbol. */
export const GS = "\x1D";

function defFor(ai: string): AiDef | undefined {
  if (ai.length === 4 && DECIMAL_PREFIXES.has(ai.slice(0, 3))) return AIS.find(a => a.ai === ai.slice(0, 3));
  return AIS.find(a => a.ai === ai);
}

/**
 * GS1 six-digit date → ISO. DD = "00" means "end of that month" (§7.12).
 * The century uses GS1's sliding window: a YY more than 49 years ahead of now
 * belongs to the previous century, more than 50 behind to the next one — so a
 * label printed today with expiry "990101" is 1999 only if that is plausible.
 */
export function gs1DateToIso(yymmdd: string, nowYear = new Date().getFullYear()): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2)), mm = Number(yymmdd.slice(2, 4));
  let dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12) return null;
  const cur = nowYear % 100, century = nowYear - cur;
  const diff = yy - cur;
  const year = diff >= 51 ? century - 100 + yy : diff <= -50 ? century + 100 + yy : century + yy;
  const monthEnd = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  if (dd === 0) dd = monthEnd;
  if (dd > monthEnd) return null;
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** ISO date → GS1 YYMMDD. Read literally, never through a Date (CLAUDE.md: a date is a date). */
export function isoToGs1Date(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`Not a date: ${iso}`);
  return `${m[1].slice(2)}${m[2]}${m[3]}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse
// ─────────────────────────────────────────────────────────────────────────────

export type Gs1Element = { ai: string; label: string; raw: string; value: string | number };
export type Gs1Parsed = {
  elements: Gs1Element[];
  /** Convenience fields for the AIs receiving cares about. */
  sscc?: string; gtin?: string; contentGtin?: string; batch?: string; serial?: string;
  productionDate?: string; packagingDate?: string; bestBefore?: string; expiry?: string;
  count?: number; netWeightKg?: number;
  errors: string[];
};

/**
 * Parse a GS1 element string as a scanner delivers it. Accepts:
 *  - raw data with GS (0x1D) separators, optionally prefixed by a symbology
 *    identifier (]C1 GS1-128, ]d2 DataMatrix, ]Q3 QR, ]e0 DataBar);
 *  - human-readable form "(01)09501101530003(17)261231(10)AB12".
 */
export function parseGs1(input: string, opts: { nowYear?: number } = {}): Gs1Parsed {
  const out: Gs1Parsed = { elements: [], errors: [] };
  let s = String(input ?? "").trim();
  s = s.replace(/^\](C1|d2|Q3|e0|J1)/, "");
  if (s.startsWith("(")) return parseHri(s, out, opts.nowYear);

  let i = 0;
  while (i < s.length) {
    if (s[i] === GS) { i++; continue; }
    // AIs are 2–4 digits; try the longest known match first.
    let def: AiDef | undefined, ai = "";
    for (const len of [4, 3, 2]) {
      const cand = s.slice(i, i + len);
      const d = defFor(cand);
      // A measure AI is always 4 digits (310n) and nothing else is, so "310"
      // on its own is never a match — its 4th digit is the decimal count.
      if (d && (len === 4) === (d.kind === "decimal")) { def = d; ai = cand; break; }
    }
    if (!def) { out.errors.push(`Unknown Application Identifier at "${s.slice(i, i + 4)}…"`); break; }
    i += ai.length;
    let raw: string;
    if (def.fixed) { raw = s.slice(i, i + def.fixed); i += def.fixed; }
    else {
      const end = s.indexOf(GS, i);
      raw = end < 0 ? s.slice(i) : s.slice(i, end);
      i = end < 0 ? s.length : end + 1;
    }
    addElement(out, ai, def, raw, opts.nowYear);
  }
  return out;
}

function parseHri(s: string, out: Gs1Parsed, nowYear?: number): Gs1Parsed {
  const re = /\((\d{2,4})\)([^(]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const def = defFor(m[1]);
    if (!def) { out.errors.push(`Unknown Application Identifier (${m[1]})`); continue; }
    addElement(out, m[1], def, m[2].trim(), nowYear);
  }
  return out;
}

function addElement(out: Gs1Parsed, ai: string, def: AiDef, raw: string, nowYear?: number) {
  const bad = (why: string) => out.errors.push(`(${ai}) ${def.label}: ${why}`);
  if (def.fixed && raw.length !== def.fixed) { bad(`expected ${def.fixed} characters, got ${raw.length}`); return; }
  if (def.max && raw.length > def.max) { bad(`longer than ${def.max} characters`); return; }
  if ((def.kind === "numeric" || def.kind === "date" || def.kind === "decimal") && !/^\d+$/.test(raw)) { bad("must be digits"); return; }

  let value: string | number = raw;
  if (def.kind === "date") {
    const iso = gs1DateToIso(raw, nowYear);
    if (!iso) { bad(`"${raw}" is not a valid YYMMDD date`); return; }
    value = iso;
  } else if (def.kind === "decimal") {
    const dp = Number(ai[3]);
    value = Number(raw) / Math.pow(10, dp);
  } else if (ai === "01" || ai === "02") {
    const g = normaliseGtin(raw);
    if ("error" in g) { bad(g.error); return; }
  } else if (ai === "00") {
    if (gs1CheckDigit(raw.slice(0, -1)) !== Number(raw.slice(-1))) { bad("check digit is wrong"); return; }
  } else if (ai === "30" || ai === "37") {
    value = Number(raw);
  }
  out.elements.push({ ai, label: def.label, raw, value });
  switch (ai) {
    case "00": out.sscc = raw; break;
    case "01": out.gtin = raw; break;
    case "02": out.contentGtin = raw; break;
    case "10": out.batch = raw; break;
    case "21": out.serial = raw; break;
    case "11": out.productionDate = value as string; break;
    case "13": out.packagingDate = value as string; break;
    case "15": out.bestBefore = value as string; break;
    case "17": out.expiry = value as string; break;
    case "30": case "37": out.count = value as number; break;
  }
  if (ai.startsWith("310")) out.netWeightKg = value as number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

export type Gs1LabelInput = {
  sscc?: string; gtin?: string; contentGtin?: string; batch?: string; serial?: string;
  productionDate?: string; packagingDate?: string; bestBefore?: string; expiry?: string;
  count?: number;
};

/**
 * Build the element string for a label. Returns both the encoded `data`
 * (fixed-length AIs first, variable ones last, GS only between variable ones —
 * the ordering GS1 recommends to keep the symbol short) and the `hri` line
 * printed under the barcode. Throws on invalid input: a label that fails to
 * scan at the customer's dock is worse than one that was never printed.
 */
export function buildGs1(f: Gs1LabelInput): { data: string; hri: string } {
  const parts: { ai: string; v: string; variable: boolean }[] = [];
  const gtinOf = (g: string, ai: string) => {
    const r = normaliseGtin(g);
    if ("error" in r) throw new Error(`(${ai}) ${r.error}`);
    return r.gtin14;
  };
  if (f.sscc) {
    if (!/^\d{18}$/.test(f.sscc) || gs1CheckDigit(f.sscc.slice(0, -1)) !== Number(f.sscc.slice(-1))) throw new Error("(00) SSCC must be 18 digits with a valid check digit");
    parts.push({ ai: "00", v: f.sscc, variable: false });
  }
  if (f.gtin) parts.push({ ai: "01", v: gtinOf(f.gtin, "01"), variable: false });
  if (f.contentGtin) parts.push({ ai: "02", v: gtinOf(f.contentGtin, "02"), variable: false });
  const dates: [keyof Gs1LabelInput, string][] = [["productionDate", "11"], ["packagingDate", "13"], ["bestBefore", "15"], ["expiry", "17"]];
  for (const [k, ai] of dates) if (f[k]) parts.push({ ai, v: isoToGs1Date(String(f[k])), variable: false });
  const alnum = (v: string, ai: string, max: number) => {
    // GS1 AI encodable character set 82 — the printable subset of ISO 646.
    if (!/^[!"%&'()*+,\-./0-9:;<=>?A-Z_a-z]+$/.test(v)) throw new Error(`(${ai}) contains characters a GS1 barcode cannot carry`);
    if (v.length > max) throw new Error(`(${ai}) longer than ${max} characters`);
    return v;
  };
  if (f.count != null) parts.push({ ai: f.contentGtin ? "37" : "30", v: String(Math.round(f.count)), variable: true });
  if (f.batch) parts.push({ ai: "10", v: alnum(f.batch, "10", 20), variable: true });
  if (f.serial) parts.push({ ai: "21", v: alnum(f.serial, "21", 20), variable: true });

  const fixed = parts.filter(p => !p.variable), variable = parts.filter(p => p.variable);
  const ordered = [...fixed, ...variable];
  const data = ordered.map((p, i) => `${p.ai}${p.v}${p.variable && i < ordered.length - 1 ? GS : ""}`).join("");
  const hri = ordered.map(p => `(${p.ai})${p.v}`).join("");
  return { data, hri };
}
