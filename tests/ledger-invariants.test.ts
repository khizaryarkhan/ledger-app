/**
 * The accounting foundation's non-negotiables.
 *
 * lib/ledger.ts states them as rules 1-3 ("Every entry balances: Σ debits =
 * Σ credits, to the cent"). These tests hold validateEntry to them. They need
 * no database: every check here throws before the function reaches its account
 * lookup, which is exactly why these invariants are cheap to guard and
 * expensive to lose.
 */
import { describe, it, expect } from "vitest";
import { validateEntry, LedgerValidationError } from "@/lib/ledger";

const ORG = "00000000-0000-0000-0000-000000000001";
const ACC_A = "00000000-0000-0000-0000-0000000000aa";
const ACC_B = "00000000-0000-0000-0000-0000000000bb";

/** Every line the ledger accepts carries exactly one of debit/credit. */
const line = (accountId: string, debit: number, credit: number) =>
  ({ accountId, debit, credit } as any);

async function expectRejection(lines: any[], matching: RegExp) {
  await expect(validateEntry(ORG, lines)).rejects.toThrowError(LedgerValidationError);
  await expect(validateEntry(ORG, lines)).rejects.toThrowError(matching);
}

describe("validateEntry — the entry must balance", () => {
  it("rejects an entry whose debits and credits differ", async () => {
    await expectRejection(
      [line(ACC_A, 100, 0), line(ACC_B, 0, 90)],
      /does not balance/i,
    );
  });

  it("rejects an imbalance of a single cent — the rule is 'to the cent'", async () => {
    await expectRejection(
      [line(ACC_A, 100.01, 0), line(ACC_B, 0, 100)],
      /does not balance/i,
    );
  });

  it("reports both totals, so the error says what is actually wrong", async () => {
    await expect(validateEntry(ORG, [line(ACC_A, 250, 0), line(ACC_B, 0, 100)]))
      .rejects.toThrowError(/250\.00.*100\.00/);
  });
});

describe("validateEntry — line shape", () => {
  it("rejects a single-sided entry (needs at least two lines)", async () => {
    await expectRejection([line(ACC_A, 100, 0)], /at least two lines/i);
  });

  it("rejects negative amounts — the opposite column expresses direction", async () => {
    await expectRejection(
      [line(ACC_A, -100, 0), line(ACC_B, 0, -100)],
      /cannot be negative/i,
    );
  });

  it("rejects a line carrying BOTH a debit and a credit", async () => {
    await expectRejection(
      [line(ACC_A, 50, 50), line(ACC_B, 0, 50)],
      /either a debit or a credit/i,
    );
  });

  it("rejects a line carrying NEITHER a debit nor a credit", async () => {
    await expectRejection(
      [line(ACC_A, 0, 0), line(ACC_B, 0, 100)],
      /either a debit or a credit/i,
    );
  });

  it("rejects a line with no account", async () => {
    await expectRejection(
      [line("", 100, 0), line(ACC_B, 0, 100)],
      /account is required/i,
    );
  });
});

describe("validateEntry — balanced entries clear every pure check", () => {
  /**
   * A well-formed entry gets past the pure checks and then reaches the account
   * lookup, which needs a database. So rather than asserting "does not throw"
   * (env-dependent), assert that whatever comes back is NOT one of the pure
   * validation failures. That holds whether a database is reachable or not,
   * which keeps this deterministic in CI.
   */
  const PURE_FAILURES = /does not balance|at least two lines|cannot be negative|either a debit or a credit|account is required/i;

  async function pureCheckFailure(lines: any[]): Promise<string | null> {
    try { await validateEntry(ORG, lines); return null; } catch (e: any) { return String(e?.message ?? e); }
  }

  it("accepts a balanced two-line entry", async () => {
    const msg = await pureCheckFailure([line(ACC_A, 100, 0), line(ACC_B, 0, 100)]);
    if (msg !== null) expect(msg).not.toMatch(PURE_FAILURES);
  });

  it("treats amounts as balanced once rounded to the cent", async () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754. Money maths must not be
    // defeated by that, so this entry has to be treated as balanced.
    const msg = await pureCheckFailure([
      line(ACC_A, 0.1, 0), line(ACC_A, 0.2, 0), line(ACC_B, 0, 0.3),
    ]);
    if (msg !== null) expect(msg).not.toMatch(/does not balance/i);
  });
});
