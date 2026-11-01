import { describe, it, expect } from "vitest";
import {
  actorLevel, buildActor, reportIds, managerChain, wouldCreateCycle,
  visibleResourceIds, canView, canEnterTimeFor, canApprove, canOpenTeamReports,
  type PersonNode,
} from "@/lib/resources/access";

//        ceo
//       /    \
//    lead     lead2
//    /  \        \
//  dev1 dev2     dev3
const nodes: PersonNode[] = [
  { id: "ceo", managerId: null },
  { id: "lead", managerId: "ceo" },
  { id: "lead2", managerId: "ceo" },
  { id: "dev1", managerId: "lead" },
  { id: "dev2", managerId: "lead" },
  { id: "dev3", managerId: "lead2" },
];

describe("actorLevel", () => {
  it("makes an org admin 'all' whatever their designation", () => {
    expect(actorLevel("company_admin", null, "self")).toBe("all");
    expect(actorLevel("super_admin", "r1", "self")).toBe("all");
  });
  it("gives a non-admin with no linked resource no access at all", () => {
    expect(actorLevel("company_user", null, "all")).toBe("none");
    expect(actorLevel("employee", null, "team")).toBe("none");
  });
  it("uses the designation for a linked person, defaulting unknown values to self", () => {
    expect(actorLevel("employee", "r1", "team")).toBe("team");
    expect(actorLevel("employee", "r1", "all")).toBe("all");
    expect(actorLevel("employee", "r1", "nonsense")).toBe("self");
    expect(actorLevel("employee", "r1", null)).toBe("self");
  });
});

describe("reportIds / managerChain", () => {
  it("collects direct and indirect reports, excluding the root", () => {
    expect([...reportIds("ceo", nodes)].sort()).toEqual(["dev1", "dev2", "dev3", "lead", "lead2"]);
    expect([...reportIds("lead", nodes)].sort()).toEqual(["dev1", "dev2"]);
    expect(reportIds("dev1", nodes).size).toBe(0);
  });
  it("survives a corrupt cycle without looping", () => {
    const looped: PersonNode[] = [{ id: "a", managerId: "b" }, { id: "b", managerId: "a" }];
    expect([...reportIds("a", looped)]).toEqual(["b"]);
    expect(managerChain("a", looped)).toEqual(["b"]);
  });
  it("lists the manager chain nearest first", () => {
    expect(managerChain("dev1", nodes)).toEqual(["lead", "ceo"]);
    expect(managerChain("ceo", nodes)).toEqual([]);
  });
});

describe("wouldCreateCycle", () => {
  it("refuses a manager who is the person or one of their reports", () => {
    expect(wouldCreateCycle("lead", "lead", nodes)).toBe(true);
    expect(wouldCreateCycle("lead", "dev1", nodes)).toBe(true);
    expect(wouldCreateCycle("ceo", "dev3", nodes)).toBe(true);
  });
  it("allows a sideways or upward move, and no manager", () => {
    expect(wouldCreateCycle("dev1", "lead2", nodes)).toBe(false);
    expect(wouldCreateCycle("dev1", "ceo", nodes)).toBe(false);
    expect(wouldCreateCycle("dev1", null, nodes)).toBe(false);
  });
});

describe("visibility", () => {
  const self = buildActor("employee", "dev1", "self");
  const lead = buildActor("employee", "lead", "team");
  const ceo = buildActor("employee", "ceo", "all");
  const admin = buildActor("company_admin", null, null);
  const stray = buildActor("company_user", null, "all");

  it("self sees only themselves", () => {
    expect([...(visibleResourceIds(self, nodes) as Set<string>)]).toEqual(["dev1"]);
    expect(canView(self, "dev2", nodes)).toBe(false);
  });
  it("team sees self plus everyone beneath, not peers or bosses", () => {
    expect(canView(lead, "lead", nodes)).toBe(true);
    expect(canView(lead, "dev2", nodes)).toBe(true);
    expect(canView(lead, "dev3", nodes)).toBe(false);
    expect(canView(lead, "ceo", nodes)).toBe(false);
  });
  it("all and admin see everyone", () => {
    expect(visibleResourceIds(ceo, nodes)).toBe("all");
    expect(visibleResourceIds(admin, nodes)).toBe("all");
  });
  it("an unlinked non-admin sees nobody", () => {
    expect((visibleResourceIds(stray, nodes) as Set<string>).size).toBe(0);
  });
  it("only team and above may open team reports", () => {
    expect(canOpenTeamReports(self)).toBe(false);
    expect(canOpenTeamReports(lead)).toBe(true);
    expect(canOpenTeamReports(ceo)).toBe(true);
    expect(canOpenTeamReports(admin)).toBe(true);
    expect(canOpenTeamReports(stray)).toBe(false);
  });
});

describe("entering and approving time", () => {
  const dev1 = buildActor("employee", "dev1", "self");
  const lead = buildActor("employee", "lead", "team");
  const ceo = buildActor("employee", "ceo", "all");
  const admin = buildActor("company_admin", null, null);

  it("a person enters their own time only; an admin may enter anyone's", () => {
    expect(canEnterTimeFor(dev1, "dev1")).toBe(true);
    expect(canEnterTimeFor(dev1, "dev2")).toBe(false);
    expect(canEnterTimeFor(lead, "dev1")).toBe(false);
    expect(canEnterTimeFor(admin, "dev1")).toBe(true);
  });
  it("a self-level person approves nobody", () => {
    expect(canApprove(dev1, "dev1", nodes)).toBe(false);
    expect(canApprove(dev1, "dev2", nodes)).toBe(false);
  });
  it("a team lead approves their reports, direct or indirect, but not themselves, peers or bosses", () => {
    expect(canApprove(lead, "dev1", nodes)).toBe(true);
    expect(canApprove(lead, "lead", nodes)).toBe(false);
    expect(canApprove(lead, "lead2", nodes)).toBe(false);
    expect(canApprove(lead, "ceo", nodes)).toBe(false);
    const ceoTeam = buildActor("employee", "ceo", "team");
    expect(canApprove(ceoTeam, "dev3", nodes)).toBe(true);
  });
  it("an 'all' person approves anyone but themselves", () => {
    expect(canApprove(ceo, "dev3", nodes)).toBe(true);
    expect(canApprove(ceo, "ceo", nodes)).toBe(false);
  });
  it("an org admin approves anyone", () => {
    expect(canApprove(admin, "dev1", nodes)).toBe(true);
  });
});
