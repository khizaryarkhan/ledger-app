import { describe, it, expect } from "vitest";
import { readInterchange } from "@/lib/edi/x12/read";
import { parse997, ta1Status, ta1Note } from "@/lib/edi/x12/inbound";
import { write999, writeTa1 } from "@/lib/edi/x12/ack";
import { write997 } from "@/lib/edi/x12/997";
import { interchangeSets, seg, type Envelope } from "@/lib/edi/x12/envelope";

// We answer a PARTNER's file: our ID is the sender.
const env: Envelope = { version: "005010", test: true, senderQualifier: "ZZ", senderId: "PRIMEFOODS", receiverQualifier: "ZZ",
  receiverId: "CUSTOMER", senderAppId: "PRIMEFOODS", receiverAppId: "CUSTOMER", controlNo: 88, now: { date: "20261126", time: "1000" } };

const received = [
  { functionalId: "PO", controlNo: 14, version: "005010", txns: [{ setId: "850", controlNo: "0001" }, { setId: "850", controlNo: "0002" }] },
  { functionalId: "IN", controlNo: 15, version: "005010", txns: [{ setId: "810", controlNo: "0001" }] },
];

describe("TA1: our answer about their envelope", () => {
  const file = writeTa1({ controlNo: 4711, date: "261125", time: "0930" }, env);

  it("is an interchange with no group, echoing their control number, date and time, accepted", () => {
    const ixn = readInterchange(file);
    expect(ixn.groups).toEqual([]);
    expect(ixn.interchangeAcks).toEqual([{ controlNo: 4711, date: "261125", time: "0930", status: "A", noteCode: "000" }]);
    expect(file).toContain("IEA*0*000000088~");
  });

  it("a TA1 inside a group is read as a segment of that set, never as an interchange acknowledgement", () => {
    const odd = interchangeSets(env, "FA", [{ txnSet: "999", body: [seg("TA1", "000004711", "261125", "0930", "A", "000")] }]);
    expect(readInterchange(odd).interchangeAcks).toEqual([]);
  });

  it("reads their TA1 status and names the note codes that every guide agrees on", () => {
    expect([ta1Status("A"), ta1Status("E"), ta1Status("R"), ta1Status("")]).toEqual(["accepted", "accepted_with_errors", "rejected", "rejected"]);
    expect(ta1Note("000")).toBeNull();
    expect(ta1Note("025")).toMatch(/duplicates an earlier one/);
    expect(ta1Note("031")).toMatch(/note code 031 \(see the partner's guide\)/);
  });
});

describe("999: our answer about their groups", () => {
  it("answers each group with AK1 (with its version), AK2 and IK5 per set, and AK9 counts", () => {
    const file = write999(received, env)!;
    const ixn = readInterchange(file);
    expect(ixn.groups).toHaveLength(1);
    expect(ixn.groups[0]).toMatchObject({ functionalId: "FA", version: "005010" });
    expect(ixn.groups[0].txns.map(t => t.setId)).toEqual(["999", "999"]);
    const first = ixn.groups[0].txns[0].segments;
    expect(first.filter(s => ["AK1", "AK2", "IK5", "AK9"].includes(s[0])).map(s => s.join("*"))).toEqual(
      ["AK1*PO*14*005010", "AK2*850*0001", "IK5*A", "AK2*850*0002", "IK5*A", "AK9*A*2*2*2"]);
  });

  it("is read back by the same reader as a 997: accepted, the group it answers, every set accepted", () => {
    const set = readInterchange(write999(received, env)!).groups[0].txns[1].segments;
    expect(parse997(set)).toMatchObject({ functionalId: "IN", groupControlNo: 15, groupStatus: "accepted", txns: [{ setId: "810", controlNo: "0001", status: "accepted", codes: [] }] });
  });

  it("never acknowledges an acknowledgement, and writes nothing when there is nothing to answer", () => {
    expect(write999([{ functionalId: "FA", controlNo: 1, txns: [{ setId: "999", controlNo: "0001" }] }], env)).toBeNull();
    expect(write999([], env)).toBeNull();
  });

  it("a 999 from a partner with IK3, IK4 and IK5 rejection is read as a rejection with its detail", () => {
    const file = interchangeSets({ ...env, senderId: "CUSTOMER", receiverId: "PRIMEFOODS" }, "FA", [{ txnSet: "999", body: [
      seg("AK1", "IN", 77, "005010"), seg("AK2", "810", "0001"), seg("IK3", "IT1", 4, "", "8"), seg("IK4", 2, 355, 7, "XX"), seg("IK5", "R", 5), seg("AK9", "R", 1, 1, 0),
    ] }]);
    const a = parse997(readInterchange(file).groups[0].txns[0].segments);
    expect(a).toMatchObject({ groupControlNo: 77, groupStatus: "rejected" });
    expect(a.txns[0].status).toBe("rejected");
    expect(a.txns[0].codes.join(" ")).toMatch(/IK3:IT1\/4\/8/);
    expect(a.txns[0].codes.join(" ")).toMatch(/IK4:2\/355\/7\/XX/);
  });

  it("our 997 is unchanged", () => {
    const set = readInterchange(write997(received, { ...env, version: "004010" })!).groups[0].txns[0].segments;
    expect(set.filter(s => s[0] === "AK5").length).toBe(2);
    expect(set.some(s => s[0] === "IK5")).toBe(false);
  });
});
