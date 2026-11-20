/**
 * X12 envelope and segment rules (ISA / GS / ST … SE / GE / IEA). Pure.
 *
 * Only lib/edi/** may build segments (tests/architecture.test.ts). Element
 * values are cleaned so they can never carry a separator, which would split
 * an element and corrupt everything after it. Dates come in as YYYY-MM-DD
 * strings and are sliced, never parsed through a Date ("a date is a date").
 */

export const ELEMENT = "*";
export const SEGMENT = "~";
export const COMPONENT = ">";

export type Envelope = {
  version: "004010" | "005010";
  test: boolean;
  senderQualifier: string; senderId: string;
  receiverQualifier: string; receiverId: string;
  senderAppId: string; receiverAppId: string;
  controlNo: number;
  /** When the file is made: CCYYMMDD and HHMM, in UTC (an instant, not a calendar date). */
  now: { date: string; time: string };
};

/** Plain ASCII, no separators, no line breaks, trimmed and capped. Accents are dropped, not the letters. */
export function clean(v: unknown, max = 80): string {
  const s = String(v ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[*~>^|]/g, " ")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/\s+/g, " ").trim();
  return s.slice(0, max).trim();
}

/** One segment; trailing empty elements are dropped, as X12 requires. */
export function seg(id: string, ...elements: (string | number | null | undefined)[]): string {
  const els = elements.map(e => (e == null ? "" : String(e)));
  while (els.length && els[els.length - 1] === "") els.pop();
  return [id, ...els].join(ELEMENT) + SEGMENT;
}

/** YYYY-MM-DD → CCYYMMDD. Refuses anything else rather than guess. */
export function ccyymmdd(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`Not a date: ${ymd}`);
  return ymd.replace(/-/g, "");
}

/** A decimal for the wire: up to `dp` places, trailing zeros dropped, never exponent notation. */
export function num(n: number, dp = 6): string {
  const s = (Math.round(n * 10 ** dp) / 10 ** dp).toFixed(dp);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

const pad = (s: string, n: number) => s.slice(0, n).padEnd(n, " ");

/** Wrap one transaction set's body segments (without ST/SE) in ST/SE, GS/GE and ISA/IEA. */
export function interchange(env: Envelope, functionalId: string, txnSet: string, body: string[]): string {
  return interchangeSets(env, functionalId, [{ txnSet, body }]);
}

/** Several transaction sets of one functional group in one interchange: ST control numbers 0001, 0002, … */
export function interchangeSets(env: Envelope, functionalId: string, sets: { txnSet: string; body: string[] }[]): string {
  if (!(env.controlNo >= 1 && env.controlNo <= 999_999_999)) throw new Error("Control number out of range.");
  if (!sets.length || sets.length > 9999) throw new Error("An interchange needs 1 to 9,999 transaction sets.");
  const ctl9 = String(env.controlNo).padStart(9, "0");
  const txns = sets.flatMap((s, i) => {
    const no = String(i + 1).padStart(4, "0");
    return [seg("ST", s.txnSet, no), ...s.body, seg("SE", s.body.length + 2, no)];
  });
  const isa = [
    "ISA", "00", pad("", 10), "00", pad("", 10),
    env.senderQualifier, pad(env.senderId, 15), env.receiverQualifier, pad(env.receiverId, 15),
    env.now.date.slice(2), env.now.time,
    env.version === "005010" ? "^" : "U", env.version === "005010" ? "00501" : "00401",
    ctl9, "0", env.test ? "T" : "P", COMPONENT,
  ].join(ELEMENT) + SEGMENT;
  const gs = seg("GS", functionalId, env.senderAppId, env.receiverAppId, env.now.date, env.now.time, env.controlNo, "X", env.version);
  return [isa, gs, ...txns, seg("GE", sets.length, env.controlNo), seg("IEA", 1, ctl9)].join("\n") + "\n";
}

/** ISA/IEA around segments with NO functional group (what a TA1 is): IEA counts zero groups. */
export function interchangeBare(env: Envelope, body: string[]): string {
  if (!(env.controlNo >= 1 && env.controlNo <= 999_999_999)) throw new Error("Control number out of range.");
  const ctl9 = String(env.controlNo).padStart(9, "0");
  const isa = [
    "ISA", "00", pad("", 10), "00", pad("", 10),
    env.senderQualifier, pad(env.senderId, 15), env.receiverQualifier, pad(env.receiverId, 15),
    env.now.date.slice(2), env.now.time,
    env.version === "005010" ? "^" : "U", env.version === "005010" ? "00501" : "00401",
    ctl9, "0", env.test ? "T" : "P", COMPONENT,
  ].join(ELEMENT) + SEGMENT;
  return [isa, ...body, seg("IEA", 0, ctl9)].join("\n") + "\n";
}

/** Split a file into segments (each as its elements), for checks and tests. */
export function segments(file: string): string[][] {
  return file.split(SEGMENT).map(s => s.replace(/^\s+/, "")).filter(Boolean).map(s => s.split(ELEMENT));
}
