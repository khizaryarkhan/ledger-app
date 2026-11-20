import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readInterchange } from "@/lib/edi/x12/read";
import { parse997, parse855, ymdFrom } from "@/lib/edi/x12/inbound";
import { ackToResponse, type AckPoLine } from "@/lib/edi/inbound";
import { interchange, seg, type Envelope } from "@/lib/edi/x12/envelope";

// A file FROM the partner: their ID is the sender.
const env: Envelope = { version: "004010", test: true, senderQualifier: "01", senderId: "123456789", receiverQualifier: "ZZ",
  receiverId: "PRIMEFOODS", senderAppId: "123456789", receiverAppId: "PRIMEFOODS", controlNo: 7, now: { date: "20261121", time: "0900" } };
const file855 = (body: string[]) => interchange(env, "PR", "855", body);
const poLines: AckPoLine[] = [
  { id: "L1", lineNo: 1, qty: 40, unitCode: "BG", closed: false },
  { id: "L2", lineNo: 2, qty: 10, unitCode: "CA", closed: false },
];
const ack = (body: string[]) => parse855(readInterchange(file855(body)).groups[0].txns[0].segments);

describe("readInterchange", () => {
  it("reads our own writer's file back: IDs, control number, test flag, one transaction set", () => {
    const ixn = readInterchange(file855([seg("BAK", "00", "AD", "PO-0042", "20261120")]));
    expect(ixn).toMatchObject({ senderQualifier: "01", senderId: "123456789", receiverId: "PRIMEFOODS", controlNo: 7, test: true });
    expect(ixn.groups[0]).toMatchObject({ functionalId: "PR", controlNo: 7, version: "004010" });
    expect(ixn.groups[0].txns[0].setId).toBe("855");
  });

  it("takes the separators from the ISA, not from our writer", () => {
    const ours = file855([seg("BAK", "00", "AD", "PO-0042", "20261120")]);
    const theirs = ours.replace(/\*/g, "|").replace(/~\n/g, "\n");
    const ixn = readInterchange(theirs);
    expect(ixn.separators).toEqual({ element: "|", component: ">", segment: "\n" });
    expect(ixn.groups[0].txns[0].segments[1]).toEqual(["BAK", "00", "AD", "PO-0042", "20261120"]);
  });

  it("refuses a file whose envelope does not add up, saying why", () => {
    const good = file855([seg("BAK", "00", "AD", "PO-0042", "20261120")]);
    expect(() => readInterchange("hello")).toThrow(/does not start with ISA/);
    expect(() => readInterchange(good.replace("SE*3*0001", "SE*9*0001"))).toThrow(/SE says 9 segments, it has 3/);
    expect(() => readInterchange(good.replace("GE*1*7", "GE*2*7"))).toThrow(/GE says 2/);
    expect(() => readInterchange(good.replace("IEA*1*000000007", "IEA*1*000000008"))).toThrow(/IEA control number/);
    expect(() => readInterchange(good.replace(/IEA\*1\*000000007~\n$/, ""))).toThrow(/no IEA/);
  });
});

describe("997", () => {
  it("reads which of our groups it answers, and whether it was accepted", () => {
    const f = interchange(env, "FA", "997", [seg("AK1", "PO", "42"), seg("AK2", "850", "0001"), seg("AK5", "A"), seg("AK9", "A", "1", "1", "1")]);
    expect(parse997(readInterchange(f).groups[0].txns[0].segments)).toMatchObject({ functionalId: "PO", groupControlNo: 42, groupStatus: "accepted", txns: [{ setId: "850", status: "accepted" }] });
    const bad = interchange(env, "FA", "997", [seg("AK1", "PO", "43"), seg("AK2", "850", "0001"), seg("AK3", "PO1", "12", "", "8"), seg("AK5", "R", "5"), seg("AK9", "R", "1", "1", "0")]);
    const r = parse997(readInterchange(bad).groups[0].txns[0].segments);
    expect(r.groupStatus).toBe("rejected");
    expect(r.txns[0].codes).toEqual(["5", "AK3:PO1/12/8"]);
  });
});

describe("855 → the supplier-response path", () => {
  it("accepted with detail and no change is a confirmation", () => {
    const a = ack([seg("BAK", "00", "AD", "PO-0042", "20261120"), seg("PO1", "1", "40", "BG", "12.5"), seg("ACK", "IA", "40", "BG")]);
    expect(ackToResponse(a, poLines)).toEqual({ ok: true, kind: "confirm", lines: [], notes: [], needsReview: false });
  });

  it("a rejected order is a decline", () => {
    expect(ackToResponse(ack([seg("BAK", "00", "RJ", "PO-0042", "20261120")]), poLines)).toMatchObject({ ok: true, kind: "decline" });
  });

  it("quantity and date changes become proposed lines, never applied here", () => {
    const a = ack([
      seg("BAK", "00", "AC", "PO-0042", "20261120"),
      seg("PO1", "1", "40", "BG", "12.5"), seg("ACK", "IQ", "30", "BG", "068", "20261205"),
      seg("PO1", "2", "10", "CA", "8"), seg("ACK", "IR", "0", "CA"),
    ]);
    expect(ackToResponse(a, poLines)).toEqual({ ok: true, kind: "revise", needsReview: false, notes: [],
      lines: [{ lineId: "L1", qty: 30, date: "2026-12-05" }, { lineId: "L2", qty: 0, date: null }] });
  });

  it("a price change is never applied and puts the file in review", () => {
    const a = ack([seg("BAK", "00", "AC", "PO-0042", "20261120"), seg("PO1", "1", "40", "BG", "13"), seg("ACK", "IP", "40", "BG")]);
    const r = ackToResponse(a, poLines);
    expect(r).toMatchObject({ ok: true, kind: "confirm", needsReview: true, notes: [expect.stringMatching(/price change.*not applied/)] });
  });

  it("a split delivery proposes the total and the latest date, and asks a person to look", () => {
    const a = ack([seg("BAK", "00", "AC", "PO-0042", "20261120"), seg("PO1", "1", "40", "BG"),
      seg("ACK", "IB", "25", "BG", "068", "20261201"), seg("ACK", "IB", "15", "BG", "068", "20261215")]);
    expect(ackToResponse(a, poLines)).toMatchObject({ ok: true, kind: "revise", needsReview: true, lines: [{ lineId: "L1", qty: 40, date: "2026-12-15" }] });
  });

  it("never guesses: an unknown line, a quantity in another unit, a bad date, an unknown BAK02", () => {
    expect(ackToResponse(ack([seg("BAK", "00", "AC", "PO-0042"), seg("PO1", "9", "1", "BG"), seg("ACK", "IA")]), poLines))
      .toEqual({ ok: false, problems: [expect.stringMatching(/Line "9" is not a line of this order/)] });
    expect(ackToResponse(ack([seg("BAK", "00", "AC", "PO-0042"), seg("PO1", "1", "40", "BG"), seg("ACK", "IQ", "1000", "KG")]), poLines))
      .toEqual({ ok: false, problems: [expect.stringMatching(/quantity is in KG, the order is in BG/)] });
    expect(ackToResponse(ack([seg("BAK", "00", "AC", "PO-0042"), seg("PO1", "1", "40", "BG"), seg("ACK", "DR", "", "", "068", "20261332")]), poLines))
      .toEqual({ ok: false, problems: [expect.stringMatching(/"20261332" is not a date/)] });
    expect(ackToResponse(ack([seg("BAK", "00", "ZZ", "PO-0042")]), poLines)).toEqual({ ok: false, problems: [expect.stringMatching(/Unknown acknowledgement type/)] });
  });

  it("reads CCYYMMDD by slicing and refuses an impossible date", () => {
    expect(ymdFrom("20260229")).toBeNull();
    expect(ymdFrom("20280229")).toBe("2028-02-29");
  });
});

describe("one supplier-response path", () => {
  it("the portal and the 855 both go through recordSupplierResponse", () => {
    const src = readFileSync("lib/accounting/po-supplier-server.ts", "utf8");
    expect(src).toMatch(/submitSupplierResponse[\s\S]*?return recordSupplierResponse\(/);
    expect(readFileSync("lib/edi/inbound-server.ts", "utf8")).toMatch(/recordSupplierResponse\(orgId, po\.id/);
  });

  it("only a decline rejects the order; a proposed change leaves it live", () => {
    // Regression: a bare `else` after the confirm branch rejected the PO for every revision too.
    const src = readFileSync("lib/accounting/po-supplier-server.ts", "utf8");
    const body = src.slice(src.indexOf("export async function recordSupplierResponse"));
    const reject = body.indexOf("rejectedAt: now");
    const guard = body.lastIndexOf('else if (kind === "decline")', reject);
    expect(reject).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(0);
    expect(body.slice(guard, reject)).not.toMatch(/\n\s*}\s*else\s*{/);
  });
});
