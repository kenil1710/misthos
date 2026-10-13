import { describe, expect, it } from "vitest";
import { roundAmount } from "@/lib/round-lifecycle";
import { currentRound } from "@/lib/rounds";
import { roundPill } from "@/lib/status-line";

const now = Date.UTC(2026, 9, 13, 9, 13);
const hour = 3_600_000;
const day = 24 * hour;
const r = (number: number, status: string, startsAt: number, endsAt: number) => ({
  number,
  status,
  startsAt: new Date(startsAt),
  endsAt: new Date(endsAt),
});

describe("currentRound: the open round, not a stale one", () => {
  it("an early close never leaves the closed round current (the production case: Round 4 open)", () => {
    const rounds = [
      r(1, "executed", now - 4 * day, now - 2 * hour),
      r(2, "closed", now - 2 * hour, now - hour),
      // Closed early; its stored window could still hold "now" (e.g. read before the worker moved endsAt).
      r(3, "closed", now - hour, now + 7 * day - hour),
      r(4, "open", now - 60_000, now + 7 * day - 60_000),
    ];
    expect(currentRound(rounds, now)?.number).toBe(4);
    expect(roundPill(currentRound(rounds, now)!, now)).toBe("Round 4 · closes in 6d 23h");
  });

  it("an open round past its end stays current until the agent closes it", () => {
    const rounds = [
      r(1, "closed", now - 9 * day, now - 2 * day),
      r(2, "open", now - 2 * day, now - hour),
    ];
    expect(currentRound(rounds, now)?.number).toBe(2);
    expect(roundPill(currentRound(rounds, now)!, now)).toBe("Round 2 · closing");
  });

  it("unchanged otherwise: a scheduled next round, a paid last round, rows without a status", () => {
    expect(
      currentRound(
        [r(1, "executed", now - 8 * day, now - day), r(2, "open", now + day, now + 8 * day)],
        now,
      )?.number,
    ).toBe(2);
    expect(currentRound([r(1, "executed", now - 8 * day, now - day)], now)?.number).toBe(1);
    const noStatus = [
      { number: 1, startsAt: new Date(now - 8 * day), endsAt: new Date(now - day) },
      { number: 2, startsAt: new Date(now - day), endsAt: new Date(now + 6 * day) },
    ];
    expect(currentRound(noStatus, now)?.number).toBe(2);
    expect(currentRound([], now)).toBeUndefined();
  });
});

describe("roundAmount: what a round's row shows", () => {
  const row = (o: Partial<Parameters<typeof roundAmount>[0]>) => ({
    status: "closed",
    totalAmount: 0n,
    approvedUnpaid: 0,
    approvedUnpaidAmount: "0",
    ...o,
  });
  it("closed or finished with nothing paid: No payouts", () => {
    expect(roundAmount(row({}))).toEqual({ kind: "none" });
    expect(roundAmount(row({ status: "executed" }))).toEqual({ kind: "none" });
  });
  it("paid or planned totals, and approved work waiting in the open round", () => {
    expect(roundAmount(row({ status: "executed", totalAmount: 1_433_333n }))).toEqual({
      kind: "usdc",
      amount: 1_433_333n,
    });
    expect(
      roundAmount(row({ status: "open", approvedUnpaid: 1, approvedUnpaidAmount: "700000" })),
    ).toEqual({ kind: "usdc", amount: 700_000n });
  });
  it("an open round with nothing approved yet stays blank (not 'No payouts')", () => {
    expect(roundAmount(row({ status: "open" }))).toEqual({ kind: "empty" });
  });
});
