/**
 * X12 reader. Pure. Reads ONE interchange (ISA … IEA) into groups and
 * transaction sets, taking the separators from the ISA itself: the element
 * separator is the 4th character, the component separator ISA16 and the
 * segment terminator the character right after it (ISA is fixed width). A
 * partner's file is read on its own terms, never on our writer's.
 *
 * Every count and control number in the envelope is checked; a file that does
 * not add up is refused with the reason, never half-read.
 */

export class X12ReadError extends Error {}
const refuse = (m: string): never => { throw new X12ReadError(m); };

export type X12Txn = { setId: string; controlNo: string; segments: string[][] };
export type X12Group = { functionalId: string; senderAppId: string; receiverAppId: string; controlNo: number; version: string; txns: X12Txn[] };
export type X12Interchange = {
  senderQualifier: string; senderId: string; receiverQualifier: string; receiverId: string;
  date: string; time: string; controlNo: number; test: boolean; groups: X12Group[];
  separators: { element: string; component: string; segment: string };
};

export function readInterchange(raw: string): X12Interchange {
  const text = raw.replace(/^﻿/, "").replace(/^\s+/, "");
  if (!text.startsWith("ISA")) refuse("This is not an X12 file: it does not start with ISA.");
  if (text.length < 106) refuse("The ISA segment is cut short.");
  const element = text[3];
  const component = text[104];
  const segment = text[105];
  if (!element || /[A-Za-z0-9\s]/.test(element)) refuse("The ISA does not declare a usable element separator.");
  if (!segment || segment === element || /[A-Za-z0-9 ]/.test(segment)) refuse("The ISA does not declare a usable segment terminator.");

  const segs = text.split(segment).map(s => s.replace(/^[\r\n]+/, "")).filter(s => s.trim() !== "").map(s => s.split(element));
  const isa = segs[0];
  if (isa.length < 17) refuse("The ISA segment does not have 16 elements.");
  const ixn: X12Interchange = {
    senderQualifier: isa[5].trim(), senderId: isa[6].trim(), receiverQualifier: isa[7].trim(), receiverId: isa[8].trim(),
    date: isa[9], time: isa[10], controlNo: Number(isa[13]), test: isa[15] === "T", groups: [],
    separators: { element, component, segment },
  };
  if (!Number.isInteger(ixn.controlNo) || ixn.controlNo < 0) refuse("The ISA control number is not a number.");

  let group: X12Group | null = null;
  let txn: X12Txn | null = null;
  let sawIea = false;
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i];
    const id = s[0].trim();
    if (sawIea) refuse("There is data after IEA: one interchange per file.");
    if (id === "GS") {
      if (group) refuse("A GS starts before the previous group ended (GE).");
      group = { functionalId: s[1], senderAppId: s[2], receiverAppId: s[3], controlNo: Number(s[6]), version: s[8] ?? "", txns: [] };
    } else if (id === "GE") {
      if (!group || txn) refuse("A GE does not close an open group.");
      if (Number(s[1]) !== group!.txns.length) refuse(`GE says ${s[1]} transaction sets; the group has ${group!.txns.length}.`);
      if (Number(s[2]) !== group!.controlNo) refuse("GE control number does not match its GS.");
      ixn.groups.push(group!); group = null;
    } else if (id === "ST") {
      if (!group || txn) refuse("An ST is outside a group or inside another transaction set.");
      txn = { setId: s[1], controlNo: s[2], segments: [s] };
    } else if (id === "SE") {
      if (!txn) refuse("An SE closes no transaction set.");
      txn!.segments.push(s);
      if (Number(s[1]) !== txn!.segments.length) refuse(`Transaction ${txn!.controlNo}: SE says ${s[1]} segments, it has ${txn!.segments.length}.`);
      if (s[2] !== txn!.controlNo) refuse(`Transaction ${txn!.controlNo}: SE control number does not match its ST.`);
      group!.txns.push(txn!); txn = null;
    } else if (id === "IEA") {
      if (group || txn) refuse("IEA comes before every group is closed.");
      if (Number(s[1]) !== ixn.groups.length) refuse(`IEA says ${s[1]} groups; the file has ${ixn.groups.length}.`);
      if (Number(s[2]) !== ixn.controlNo) refuse("IEA control number does not match the ISA.");
      sawIea = true;
    } else {
      if (!txn) refuse(`Segment ${id} is outside a transaction set.`);
      txn!.segments.push(s);
    }
  }
  if (!sawIea) refuse("The file has no IEA: it is cut short.");
  return ixn;
}

/** Element n of a segment (1-based, as X12 numbers them), trimmed; "" when absent. */
export const el = (s: string[] | undefined, n: number) => (s?.[n] ?? "").trim();
