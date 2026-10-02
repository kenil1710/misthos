import { concat, encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  contributorIdBytes32,
  hashOfHashes,
  payoutIdFor,
  programIdBytes32,
  roundIdBytes32,
} from "../src/rounds/ids";
import {
  MAX_PAYOUTS_PER_ROUND,
  planRound,
  type PayableItem,
  type PayeeState,
} from "../src/rounds/plan";

const U = 1_000_000n;
const P = programIdBytes32("p");
const R = roundIdBytes32("r");
const wallet = (c: string) => `0x${Buffer.from(c).toString("hex").padStart(40, "0")}` as Address;
const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
let seq = 0;
const item = (c: string, amount: bigint, minute = seq++): PayableItem => ({
  submissionId: `s${String(minute).padStart(3, "0")}-${c}`,
  contributorId: c,
  contributorBytes32: contributorIdBytes32(c),
  wallet: wallet(c),
  amount,
  decisionHash: h(minute + 1),
  createdAt: new Date(Date.UTC(2026, 9, 7, 0, minute)),
});
const ready = (...cs: string[]) =>
  new Map<string, PayeeState>(cs.map((c) => [c, { wallet: wallet(c), payableAfter: 0n }]));
const limits = {
  maxPerPayout: 50n * U,
  maxPerRound: 100n * U,
  maxPerDay: 200n * U,
  spentInWindow: 0n,
};
const plan = (items: PayableItem[], o: Partial<Parameters<typeof planRound>[0]> = {}) =>
  planRound({
    programBytes32: P,
    roundBytes32: R,
    items,
    payees: ready("a", "b", "c"),
    limits,
    nowSeconds: 1_800_000_000n,
    ...o,
  });

describe("ids", () => {
  it("payoutId = keccak256(abi.encode(programId, roundId, contributorId))", () => {
    const c = contributorIdBytes32("a");
    expect(payoutIdFor(P, R, c)).toBe(
      keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
          [P, R, c],
        ),
      ),
    );
    expect(payoutIdFor(P, R, c)).not.toBe(payoutIdFor(P, roundIdBytes32("r2"), c));
  });

  it("hashOfHashes is order-independent and matches sorted concatenation", () => {
    expect(hashOfHashes([h(2), h(1)])).toBe(hashOfHashes([h(1), h(2)]));
    expect(hashOfHashes([h(2), h(1)])).toBe(keccak256(concat([h(1), h(2)])));
  });
});

describe("planRound", () => {
  it("aggregates per contributor in submission order with deterministic ids and root", () => {
    const items = [item("a", 10n * U), item("b", 5n * U), item("a", 7n * U)];
    const r = plan(items);
    expect(r.total).toBe(22n * U);
    expect(r.payouts.map((x) => [x.contributorId, x.amount, x.submissionIds.length])).toEqual([
      ["a", 17n * U, 2],
      ["b", 5n * U, 1],
    ]);
    expect(r.payouts[0]!.payoutId).toBe(payoutIdFor(P, R, contributorIdBytes32("a")));
    expect(r.payouts[0]!.decisionHash).toBe(
      hashOfHashes([items[0]!.decisionHash, items[2]!.decisionHash]),
    );
    expect(r.decisionRoot).toBe(hashOfHashes(items.map((i) => i.decisionHash)));
    expect(r.deferred).toEqual([]);
    // same input in a different order → identical plan
    expect(plan([items[2]!, items[1]!, items[0]!])).toEqual(r);
  });

  it("never lets one contributor exceed maxPerPayout; items that don't fit are deferred whole", () => {
    const items = [item("a", 30n * U), item("a", 25n * U), item("a", 20n * U)];
    const r = plan(items);
    expect(r.payouts[0]!.amount).toBe(50n * U); // 30 + 20; the 25 doesn't fit
    expect(r.deferred).toEqual([
      { submissionId: items[1]!.submissionId, reason: "per_payout_cap" },
    ]);
  });

  it("keeps the round within maxPerRound, first come first paid", () => {
    const r = plan([item("a", 50n * U), item("b", 40n * U), item("c", 30n * U)]);
    expect(r.total).toBe(90n * U);
    expect(r.deferred.map((d) => d.reason)).toEqual(["round_cap"]);
  });

  it("respects the vault's rolling daily cap", () => {
    const r = plan([item("a", 40n * U), item("b", 40n * U)], {
      limits: { ...limits, spentInWindow: 150n * U },
    });
    expect(r.total).toBe(40n * U);
    expect(r.deferred).toEqual([{ submissionId: expect.any(String), reason: "daily_cap" }]);
    expect(
      plan([item("a", 1n * U)], { limits: { ...limits, spentInWindow: 250n * U } }).total,
    ).toBe(0n);
  });

  it("defers contributors whose payee isn't registered to their current wallet, or is in cooldown", () => {
    const payees = new Map<string, PayeeState>([
      ["a", { wallet: wallet("old"), payableAfter: 0n }],
      ["b", { wallet: wallet("b"), payableAfter: 1_900_000_000n }],
    ]);
    const r = plan([item("a", 1n * U), item("b", 1n * U), item("c", 1n * U)], { payees });
    expect(r.payouts).toEqual([]);
    expect(r.deferred.map((d) => d.reason)).toEqual([
      "payee_not_registered",
      "payee_cooldown",
      "payee_not_registered",
    ]);
  });

  it("caps the number of payouts at the contract's limit", () => {
    const items = Array.from({ length: MAX_PAYOUTS_PER_ROUND + 3 }, (_, i) => item(`k${i}`, 1n));
    const payees = new Map(
      items.map((i) => [i.contributorId, { wallet: i.wallet, payableAfter: 0n }]),
    );
    const r = plan(items, { payees });
    expect(r.payouts).toHaveLength(MAX_PAYOUTS_PER_ROUND);
    expect(r.deferred.filter((d) => d.reason === "too_many_payouts")).toHaveLength(3);
  });

  it("ignores zero amounts and returns an empty plan with a well-defined root", () => {
    const r = plan([item("a", 0n)]);
    expect(r).toMatchObject({ payouts: [], total: 0n });
    expect(r.decisionRoot).toBe(keccak256("0x"));
  });
});
