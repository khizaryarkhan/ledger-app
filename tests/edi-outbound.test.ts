import { describe, it, expect } from "vitest";
import { readInterchange } from "@/lib/edi/x12/read";
import { parse855 } from "@/lib/edi/x12/inbound";
import { write855 } from "@/lib/edi/x12/855";
import { buildOrderAck, type SoAckFacts } from "@/lib/edi/build/sales-order";
import type { Envelope } from "@/lib/edi/x12/envelope";

// We are the SELLER: our ID is the sender, the customer's the receiver.
const env: Envelope = { version: "004010", test: true, senderQualifier: "ZZ", senderId: "PRIMEFOODS", receiverQualifier: "ZZ",
  receiverId: "CUSTOMER", senderAppId: "PRIMEFOODS", receiverAppId: "CUSTOMER", controlNo: 31, now: { date: "20261126", time: "1000" } };

const facts = (over: Partial<SoAckFacts> = {}): SoAckFacts => ({
  so: { docNumber: "SO-0007", partyRef: "CUST-PO-77", issueDate: "2026-11-20", currency: "EUR", confirmed: true, promisedDate: null },
  lines: [
    { lineNo: 1, orderUom: "kg", baseUom: "kg", qty: 40, rate: 0.5, promisedDate: "2026-12-05", requestedDate: "2026-12-05", closed: false },
    { lineNo: 2, orderUom: "carton", baseUom: "kg", qty: 3, rate: 100, promisedDate: "2026-12-05", requestedDate: "2026-12-05", closed: false },
  ],
  theirs: [
    { lineNo: "10", qty: 40, unit: "KG", price: 0.5, requestedDate: "2026-12-05" },
    { lineNo: "20", qty: 3, unit: "CT", price: 100, requestedDate: "2026-12-05" },
  ],
  ...over,
});
const build = (f: SoAckFacts) => buildOrderAck(f, {});
const ack = (f: SoAckFacts) => { const r = build(f); if (r.ok === false) throw new Error(JSON.stringify(r.problems)); return r.ack; };

describe("855 builder", () => {
  it("accepts a line exactly as ordered (IA), echoes THEIR line numbers, and the whole order is accepted with detail (AD)", () => {
    const a = ack(facts());
    expect(a).toMatchObject({ poNumber: "CUST-PO-77", poDate: "2026-11-20", currency: "EUR", type: "AD" });
    expect(a.lines.map(l => l.lineNo)).toEqual(["10", "20"]);
    expect(a.lines[0]).toEqual({ lineNo: "10", qty: 40, unit: "KG", price: 0.5, acks: [{ status: "IA", qty: 40, unit: "KG", date: "2026-12-05" }] });
  });

  it("a different quantity is IQ, a different price IP, a moved date DR, a closed line IR; the order is then AC", () => {
    const f = facts();
    f.lines[0].qty = 30;                       // short
    f.lines[1].rate = 110;                     // dearer
    const a = ack(f);
    expect(a.type).toBe("AC");
    expect(a.lines[0].acks).toEqual([{ status: "IQ", qty: 30, unit: "KG", date: "2026-12-05" }]);
    expect(a.lines[1].acks).toEqual([{ status: "IP", qty: 3, unit: "CT", date: "2026-12-05" }]);
    const moved = facts(); moved.lines[0].promisedDate = "2026-12-12";
    expect(ack(moved).lines[0].acks).toEqual([{ status: "DR", qty: 40, unit: "KG", date: "2026-12-12" }]);
    const closed = facts(); closed.lines[1].closed = true;
    expect(ack(closed).lines[1].acks).toEqual([{ status: "IR", qty: 0, unit: "CT", date: null }]);
  });

  it("an order keyed by hand (no 850) uses its own line numbers and values", () => {
    const a = ack(facts({ theirs: null }));
    expect(a.lines.map(l => l.lineNo)).toEqual(["1", "2"]);
    expect(a.type).toBe("AD");
  });

  it("never guesses: no customer PO number, not confirmed, lines that no longer match their order, a unit they did not use", () => {
    const fail = (f: SoAckFacts) => { const r = build(f); return r.ok === false ? r.problems.map(p => p.message).join(" | ") : "OK"; };
    expect(fail(facts({ so: { ...facts().so, partyRef: null } }))).toMatch(/no customer PO number/);
    expect(fail(facts({ so: { ...facts().so, confirmed: false } }))).toMatch(/Confirm the order first/);
    expect(fail(facts({ theirs: facts().theirs!.slice(0, 1) }))).toMatch(/2 line\(s\), their order had 1/);
    const unit = facts(); unit.theirs![0].unit = "LB";
    expect(fail(unit)).toMatch(/They ordered in LB, the line is in KG now/);
    const nounit = facts(); nounit.lines[0].orderUom = "wibble"; nounit.lines[0].baseUom = null;
    expect(fail(nounit)).toMatch(/Unit:/);
  });
});

describe("855 writer", () => {
  it("is a valid one-set file our own reader and parse855 agree with: BAK, PO1 echo, ACK per status", () => {
    const f = facts(); f.lines[0].qty = 30;
    const file = write855(ack(f), env);
    const ixn = readInterchange(file);
    expect(ixn).toMatchObject({ senderId: "PRIMEFOODS", receiverId: "CUSTOMER", controlNo: 31, test: true });
    expect(ixn.groups[0]).toMatchObject({ functionalId: "PR", version: "004010" });
    const back = parse855(ixn.groups[0].txns[0].segments);
    expect(back).toMatchObject({ ackType: "AC", poNumber: "CUST-PO-77", poDate: "2026-11-20" });
    expect(back.lines[0]).toMatchObject({ lineNo: "10", qty: 40, unit: "KG", price: 0.5 });
    expect(back.lines[0].acks).toEqual([{ status: "IQ", qty: 30, unit: "KG", dateQualifier: "067", date: "2026-12-05", rawDate: "20261205" }]);
    expect(back.lines[1].acks[0]).toMatchObject({ status: "IA", qty: 3, unit: "CT" });
  });

  it("states the currency and ends with the line count", () => {
    const segs = readInterchange(write855(ack(facts()), env)).groups[0].txns[0].segments;
    expect(segs.find(s => s[0] === "CUR")).toEqual(["CUR", "SE", "EUR"]);
    expect(segs.find(s => s[0] === "CTT")).toEqual(["CTT", "2"]);
    expect(segs.find(s => s[0] === "BAK")).toEqual(["BAK", "00", "AD", "CUST-PO-77", "20261120"]);
  });
});
