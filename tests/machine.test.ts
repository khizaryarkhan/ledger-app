import { describe, it, expect } from "vitest";
import {
  usageForWorkCentre, isFirm, readMachineLinks, emptyUsage, splitDowntime,
  type CompletionRun,
} from "@/lib/resources/machine";

const LATHE = "wc-lathe";
const PRESS = "wc-press";

/** op1/op2 run on the lathe, op3 on the press, op4 has no work centre at all. */
const OPS = new Map<string, string | null>([
  ["op1", LATHE], ["op2", LATHE], ["op3", PRESS], ["op4", null],
]);

const run = (over: Partial<CompletionRun> = {}): CompletionRun => ({
  runId: "r1", producedDate: "2026-11-10", moId: "mo1",
  operationHours: [{ operationId: "op1", hours: 4, entered: true }], ...over,
});

const use = (runs: CompletionRun[], from = "2026-11-01", to = "2026-11-30") =>
  usageForWorkCentre(LATHE, runs, OPS, from, to);

describe("which hours belong to a machine", () => {
  it("counts only operations that ran at this machine's work centre", () => {
    const u = use([run({
      operationHours: [
        { operationId: "op1", hours: 4, entered: true },   // lathe
        { operationId: "op3", hours: 9, entered: true },   // press — not ours
        { operationId: "op4", hours: 7, entered: true },   // no work centre — nobody's
      ],
    })]);
    expect(u.hours).toBe(4);
  });

  it("adds several operations on the same machine, and counts the run once", () => {
    const u = use([run({
      operationHours: [
        { operationId: "op1", hours: 3, entered: true },
        { operationId: "op2", hours: 2.5, entered: true },
      ],
    })]);
    expect(u.hours).toBe(5.5);
    expect(u.runs).toBe(1);
  });

  it("does not count a run that booked nothing here", () => {
    const u = use([run({ operationHours: [{ operationId: "op3", hours: 6, entered: true }] })]);
    expect(u.runs).toBe(0);
    expect(u.hours).toBe(0);
  });

  it("ignores hours that are zero, negative or not a number", () => {
    const u = use([run({
      operationHours: [
        { operationId: "op1", hours: 0, entered: true },
        { operationId: "op1", hours: -3, entered: true },
        { operationId: "op1", hours: Number.NaN, entered: true },
        { operationId: "op1", hours: 2, entered: true },
      ],
    })]);
    expect(u.hours).toBe(2);
  });
});

describe("the date window", () => {
  it("includes both ends and excludes anything outside", () => {
    const u = use([
      run({ runId: "a", producedDate: "2026-10-31" }),   // day before
      run({ runId: "b", producedDate: "2026-11-01" }),   // first day
      run({ runId: "c", producedDate: "2026-11-30" }),   // last day
      run({ runId: "d", producedDate: "2026-12-01" }),   // day after
    ]);
    expect(u.runs).toBe(2);
    expect(u.hours).toBe(8);
  });

  it("does not guess an undated run into a window", () => {
    const u = use([run({ producedDate: null })]);
    expect(u.runs).toBe(0);
    expect(u.hours).toBe(0);
  });
});

describe("whether the hours are real", () => {
  it("separates typed, defaulted and unrecorded hours", () => {
    const u = use([run({
      operationHours: [
        { operationId: "op1", hours: 4, entered: true },
        { operationId: "op1", hours: 3, entered: false },
        { operationId: "op1", hours: 2 },                    // a run from before the flag
      ],
    })]);
    expect(u.hours).toBe(9);
    expect(u.firmHours).toBe(4);
    expect(u.estimatedHours).toBe(3);
    expect(u.notRecordedHours).toBe(2);
  });

  it("never reads a missing flag as firm", () => {
    // The whole point: a run from before the flag existed is UNKNOWN, and
    // calling it firm would present the plan as measurement.
    const u = use([run({ operationHours: [{ operationId: "op1", hours: 8 }] })]);
    expect(u.firmHours).toBe(0);
    expect(u.notRecordedHours).toBe(8);
    expect(isFirm(u)).toBe(false);
  });

  it("is firm only when every hour was typed", () => {
    expect(isFirm(use([run()]))).toBe(true);
    const mixed = use([run({
      operationHours: [
        { operationId: "op1", hours: 4, entered: true },
        { operationId: "op1", hours: 1, entered: false },
      ],
    })]);
    expect(isFirm(mixed)).toBe(false);
  });

  it("is not firm when there are no hours at all", () => {
    // Nothing used is not the same claim as "used for zero hours, confirmed".
    expect(isFirm(emptyUsage())).toBe(false);
  });
});

describe("a machine's downtime", () => {
  const NOW = new Date("2026-11-02T10:00:00Z");
  const row = (id: string, startedAt: string, endedAt: string | null, planned: boolean) =>
    ({ id, startedAt, endedAt, reason: planned ? "maintenance" : "breakdown", planned });

  it("keeps a window still ahead out of the minutes entirely", () => {
    const d = splitDowntime([row("m", "2026-11-09T08:00:00Z", "2026-11-09T12:00:00Z", true)], NOW);
    expect(d.upcoming.map(r => r.id)).toEqual(["m"]);
    expect(d.happened).toHaveLength(0);
    expect(d.plannedMinutes).toBe(0);
    expect(d.unplannedMinutes).toBe(0);
  });

  it("separates planned from unplanned minutes", () => {
    const d = splitDowntime([
      row("a", "2026-11-01T08:00:00Z", "2026-11-01T09:00:00Z", false),  // 60 breakdown
      row("b", "2026-11-01T10:00:00Z", "2026-11-01T10:30:00Z", true),   // 30 maintenance
    ], NOW);
    expect(d.unplannedMinutes).toBe(60);
    expect(d.plannedMinutes).toBe(30);
  });

  it("runs a stoppage with no end up to now", () => {
    const d = splitDowntime([row("a", "2026-11-02T09:00:00Z", null, false)], NOW);
    expect(d.unplannedMinutes).toBe(60);
  });

  it("orders what is booked soonest first and what happened newest first", () => {
    const d = splitDowntime([
      row("late", "2026-11-20T08:00:00Z", null, true),
      row("soon", "2026-11-05T08:00:00Z", null, true),
      row("old", "2026-10-01T08:00:00Z", "2026-10-01T09:00:00Z", false),
      row("new", "2026-11-01T08:00:00Z", "2026-11-01T09:00:00Z", false),
    ], NOW);
    expect(d.upcoming.map(r => r.id)).toEqual(["soon", "late"]);
    expect(d.happened.map(r => r.id)).toEqual(["new", "old"]);
  });

  it("skips a row whose start is not a date", () => {
    const d = splitDowntime([row("bad", "not a date", null, false)], NOW);
    expect(d.upcoming).toHaveLength(0);
    expect(d.happened).toHaveLength(0);
  });
});

describe("linking a machine", () => {
  it("lets equipment set, clear or leave alone each link", () => {
    expect(readMachineLinks(true, { workCentreId: "wc1", fixedAssetId: "fa1" }))
      .toEqual({ ok: true, workCentreId: "wc1", fixedAssetId: "fa1" });
    expect(readMachineLinks(true, { workCentreId: null }))
      .toEqual({ ok: true, workCentreId: null, fixedAssetId: undefined });
    expect(readMachineLinks(true, { fixedAssetId: "" }))
      .toEqual({ ok: true, workCentreId: undefined, fixedAssetId: null });
    // Not mentioning a link must leave it alone, so an edit form that omits
    // them cannot silently unlink a machine.
    expect(readMachineLinks(true, {})).toEqual({ ok: true, workCentreId: undefined, fixedAssetId: undefined });
  });

  it("REFUSES to link a person rather than silently dropping the field", () => {
    // An ignored field reads as "saved" to the caller, and a person with a work
    // centre would charge a machine's hours to a human.
    const r = readMachineLinks(false, { workCentreId: "wc1" });
    expect(r.ok).toBe(false);
    if ("error" in r) expect(r.error).toContain("Only equipment");
    expect(readMachineLinks(false, { fixedAssetId: "fa1" }).ok).toBe(false);
  });

  it("lets a person's edit mention the fields without setting them", () => {
    // The shared edit form sends these as empty for everyone.
    expect(readMachineLinks(false, { workCentreId: "", fixedAssetId: null })).toEqual({ ok: true });
    expect(readMachineLinks(false, {})).toEqual({ ok: true });
  });

  it("refuses an id that is not a string", () => {
    expect(readMachineLinks(true, { workCentreId: 42 }).ok).toBe(false);
    expect(readMachineLinks(true, { fixedAssetId: { id: "x" } }).ok).toBe(false);
  });
});
