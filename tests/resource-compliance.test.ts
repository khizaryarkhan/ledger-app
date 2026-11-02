import { describe, it, expect } from "vitest";
import { buildCompliance, weekKey, type ComplianceEntry, type Expected } from "@/lib/resources/compliance";
import { addDays } from "@/lib/accounting/report-periods";

// 2026-11-02 is a Monday (verified).
const W1 = "2026-10-26";
const W2 = "2026-11-02";
const WEEKS = [W1, W2];
const weekEndOf = (w: string) => addDays(w, 6);

const ALICE = { resourceId: "alice", name: "Alice" };
const PEOPLE = [ALICE];

/** Everyone is expected 40h in both weeks unless a test says otherwise. */
function expected(hours = 40, onRecord = true): Map<string, Expected> {
  const m = new Map<string, Expected>();
  for (const w of WEEKS) m.set(weekKey("alice", w), { hours, onRecord });
  return m;
}

const entry = (over: Partial<ComplianceEntry> = {}): ComplianceEntry => ({
  resourceId: "alice", date: W2, hours: 8, status: "approved", isPublicHoliday: false, ...over,
});

/** A full 40h week, so only the week under test can fail. */
const fullWeek = (weekStart: string, status = "approved"): ComplianceEntry[] =>
  [0, 1, 2, 3, 4].map((i) => entry({ date: addDays(weekStart, i), hours: 8, status }));

function run(entries: ComplianceEntry[], opts: { expected?: Map<string, Expected>; startedOn?: Map<string, string | null> } = {}) {
  return buildCompliance({
    weeks: WEEKS, weekEndOf, people: PEOPLE, entries,
    expected: opts.expected ?? expected(),
    startedOn: opts.startedOn ?? new Map([["alice", W1]]),
    activeFrom: W1,
  });
}

describe("a week that is fully handed in", () => {
  it("produces no row and counts the person as clear", () => {
    const r = run([...fullWeek(W1), ...fullWeek(W2)]);
    expect(r.rows).toEqual([]);
    expect(r.clear).toBe(1);
    expect(r.dormant).toEqual([]);
  });
});

describe("not submitted", () => {
  it("reports the whole week when nothing was handed in", () => {
    const r = run(fullWeek(W1));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].weekStart).toBe(W2);
    expect(r.rows[0].shortBy).toBe(40);
    expect(r.rows[0].notSubmitted).toBe(true);
  });

  it("reports the shortfall, not a yes/no, when a week is part handed in", () => {
    const r = run([...fullWeek(W1), ...fullWeek(W2).slice(0, 3)]);
    expect(r.rows[0].submitted).toBe(24);
    expect(r.rows[0].shortBy).toBe(16);
  });

  it("does not count draft hours as handed in", () => {
    const r = run([...fullWeek(W1), ...fullWeek(W2, "draft")]);
    expect(r.rows[0].submitted).toBe(0);
    expect(r.rows[0].shortBy).toBe(40);
  });

  it("does not count rejected hours as handed in — they came back", () => {
    const r = run([...fullWeek(W1), ...fullWeek(W2, "rejected")]);
    expect(r.rows[0].shortBy).toBe(40);
  });

  it("counts submitted, approved and posted alike", () => {
    for (const status of ["submitted", "approved", "posted"]) {
      const r = run([...fullWeek(W1), ...fullWeek(W2, status)]);
      expect(r.rows.filter((x) => x.notSubmitted)).toEqual([]);
    }
  });
});

describe("not approved", () => {
  it("flags a full week nobody has decided, without calling it short", () => {
    const r = run([...fullWeek(W1), ...fullWeek(W2, "submitted")]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].notSubmitted).toBe(false);
    expect(r.rows[0].notApproved).toBe(true);
    expect(r.rows[0].awaitingApproval).toBe(40);
  });

  it("does not flag an approved or posted week", () => {
    const r = run([...fullWeek(W1), ...fullWeek(W2, "posted")]);
    expect(r.rows).toEqual([]);
  });

  it("can report both failures on one week", () => {
    const r = run([...fullWeek(W1), ...fullWeek(W2, "submitted").slice(0, 2)]);
    expect(r.rows[0].notSubmitted).toBe(true);
    expect(r.rows[0].notApproved).toBe(true);
    expect(r.rows[0].shortBy).toBe(24);
    expect(r.rows[0].awaitingApproval).toBe(16);
  });
});

describe("who is worth chasing", () => {
  it("lists someone with only public holidays apart, and does not chase them", () => {
    const r = run([entry({ date: W2, status: "approved", isPublicHoliday: true })]);
    expect(r.rows).toEqual([]);
    expect(r.dormant).toEqual([{ resourceId: "alice", name: "Alice", lastLoggedOn: null }]);
  });

  it("lists someone who has logged nothing at all apart", () => {
    const r = run([]);
    expect(r.rows).toEqual([]);
    expect(r.dormant[0].lastLoggedOn).toBeNull();
  });

  it("does not chase a week before the person ever logged anything", () => {
    // Started in week 2: week 1 is not theirs to answer for.
    const r = run(fullWeek(W2, "approved"), { startedOn: new Map([["alice", W2]]) });
    expect(r.rows).toEqual([]);
  });

  it("still chases an earlier week for someone who started before the window", () => {
    const r = run(fullWeek(W2, "approved"), { startedOn: new Map([["alice", "2026-01-05"]]) });
    expect(r.rows.map((x) => x.weekStart)).toEqual([W1]);
  });
});

describe("the expected figure", () => {
  it("raises nothing when the week expects nothing — a shutdown is not a failure", () => {
    const r = run([], { expected: expected(0) });
    // No entries at all, so they are dormant rather than short; the point is
    // that no row claims they owe hours.
    expect(r.rows).toEqual([]);
  });

  it("carries through whether it rests on contracted hours or a fallback column", () => {
    const soft = run(fullWeek(W1), { expected: expected(40, false) });
    expect(soft.rows[0].capacityOnRecord).toBe(false);
    const firm = run(fullWeek(W1), { expected: expected(40, true) });
    expect(firm.rows[0].capacityOnRecord).toBe(true);
  });

  it("measures each week against its own expectation", () => {
    const mixed = new Map<string, Expected>([
      [weekKey("alice", W1), { hours: 40, onRecord: true }],
      [weekKey("alice", W2), { hours: 16, onRecord: true }],
    ]);
    // 16h handed in each week: short in week 1, exactly right in week 2.
    const r = run([...fullWeek(W1).slice(0, 2), ...fullWeek(W2).slice(0, 2)], { expected: mixed });
    expect(r.rows.map((x) => [x.weekStart, x.shortBy])).toEqual([[W1, 24]]);
  });
});
