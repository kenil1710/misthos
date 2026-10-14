import type { Address, Hex } from "viem";
import { hashOfHashes, payoutIdFor } from "./ids";

/**
 * Payouts the agent puts in one round. The vault accepts up to 200 (MisthosVault.MAX_PAYOUTS_PER_ROUND), but a
 * 200-payout proposeRound costs ~30.4M gas and Arc's block gas limit is 30M, so it could never land. 50 keeps
 * proposeRound (~6.3M) and executeRound (~3.1M) under half a block (MisthosVault.gas.t.sol). The rest carry over.
 */
export const MAX_PAYOUTS_PER_ROUND = 50;

export interface PayableItem {
  submissionId: string;
  contributorId: string;
  contributorBytes32: Hex;
  /** The contributor's current payout wallet (from the DB). */
  wallet: Address;
  amount: bigint;
  decisionHash: Hex;
  createdAt: Date;
  /** When the work was approved (its latest decision): payment order, first approved first paid. Default createdAt. */
  approvedAt?: Date;
}

export interface PayeeState {
  wallet: Address | null;
  payableAfter: bigint;
}

export interface PlanLimits {
  maxPerPayout: bigint;
  maxPerRound: bigint;
  maxPerDay: bigint;
  /** USDC already paid out in the vault's rolling 24h window. */
  spentInWindow: bigint;
  /**
   * What the vault can pay this round: its balance minus rounds of this program already proposed and not paid. A round
   * is never proposed for more than this. Omitted: no balance limit.
   */
  available?: bigint;
}

export type DeferReason =
  | "payee_not_registered"
  | "payee_cooldown"
  | "per_payout_cap"
  | "round_cap"
  | "daily_cap"
  | "too_many_payouts"
  | "insufficient_funds";

export interface PlannedPayout {
  contributorId: string;
  contributorBytes32: Hex;
  payoutId: Hex;
  to: Address;
  amount: bigint;
  /** keccak256 of the sorted decision hashes of the submissions this payout covers. */
  decisionHash: Hex;
  submissionIds: string[];
  decisionHashes: Hex[];
}

export interface RoundPlan {
  payouts: PlannedPayout[];
  deferred: { submissionId: string; reason: DeferReason }[];
  total: bigint;
  /** keccak256 over every included decision hash (sorted). Committed on-chain as roundDecisionRoot. */
  decisionRoot: Hex;
}

/**
 * Turn approved, unpaid items into vault payouts, deterministically. Nothing here can exceed what the vault would
 * accept: payee must be registered to the same wallet and out of cooldown; per-contributor total ≤ maxPerPayout;
 * round total ≤ min(maxPerRound, maxPerDay − spentInWindow) and ≤ the funds available; ≤ MAX_PAYOUTS_PER_ROUND payouts.
 * Items go in approval order (first approved, first paid), one payout per contributor. Whole submissions are never
 * split: anything that doesn't fit is deferred to a later round with a reason.
 */
export function planRound(p: {
  programBytes32: Hex;
  roundBytes32: Hex;
  items: PayableItem[];
  payees: Map<string, PayeeState>;
  limits: PlanLimits;
  nowSeconds: bigint;
}): RoundPlan {
  const deferred: RoundPlan["deferred"] = [];
  const at = (i: PayableItem) => (i.approvedAt ?? i.createdAt).getTime();
  // First approved, first paid: items in approval order, each added to its contributor's one payout if it fits.
  const sorted = p.items
    .filter((it) => it.amount > 0n)
    .sort(
      (a, b) =>
        at(a) - at(b) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.submissionId.localeCompare(b.submissionId),
    );

  const roundRoom = (() => {
    const dayRoom = p.limits.maxPerDay - p.limits.spentInWindow;
    return dayRoom < p.limits.maxPerRound ? (dayRoom < 0n ? 0n : dayRoom) : p.limits.maxPerRound;
  })();
  const dailyBinds = p.limits.maxPerDay - p.limits.spentInWindow < p.limits.maxPerRound;
  const available =
    p.limits.available === undefined ? null : p.limits.available < 0n ? 0n : p.limits.available;

  /** Why a contributor can't be paid this round at all (payee checks), once per contributor. */
  const blocked = new Map<string, DeferReason | null>();
  const buckets = new Map<string, PayableItem[]>();
  const sums = new Map<string, bigint>();
  let total = 0n;
  for (const it of sorted) {
    if (!blocked.has(it.contributorId)) {
      const payee = p.payees.get(it.contributorId);
      blocked.set(
        it.contributorId,
        !payee?.wallet || payee.wallet.toLowerCase() !== it.wallet.toLowerCase()
          ? "payee_not_registered"
          : payee.payableAfter > p.nowSeconds
            ? "payee_cooldown"
            : null,
      );
    }
    const reason = blocked.get(it.contributorId);
    if (reason) {
      deferred.push({ submissionId: it.submissionId, reason });
      continue;
    }
    if (!buckets.has(it.contributorId) && buckets.size >= MAX_PAYOUTS_PER_ROUND) {
      deferred.push({ submissionId: it.submissionId, reason: "too_many_payouts" });
      continue;
    }
    const sum = sums.get(it.contributorId) ?? 0n;
    if (sum + it.amount > p.limits.maxPerPayout) {
      deferred.push({ submissionId: it.submissionId, reason: "per_payout_cap" });
      continue;
    }
    if (total + it.amount > roundRoom) {
      deferred.push({
        submissionId: it.submissionId,
        reason: dailyBinds ? "daily_cap" : "round_cap",
      });
      continue;
    }
    if (available !== null && total + it.amount > available) {
      deferred.push({ submissionId: it.submissionId, reason: "insufficient_funds" });
      continue;
    }
    buckets.set(it.contributorId, [...(buckets.get(it.contributorId) ?? []), it]);
    sums.set(it.contributorId, sum + it.amount);
    total += it.amount;
  }

  const payouts: PlannedPayout[] = [...buckets.entries()].map(([contributorId, included]) => {
    const first = included[0]!;
    const hashes = included.map((i) => i.decisionHash);
    return {
      contributorId,
      contributorBytes32: first.contributorBytes32,
      payoutId: payoutIdFor(p.programBytes32, p.roundBytes32, first.contributorBytes32),
      to: first.wallet,
      amount: sums.get(contributorId)!,
      decisionHash: hashOfHashes(hashes),
      submissionIds: included.map((i) => i.submissionId),
      decisionHashes: hashes,
    };
  });
  return {
    payouts,
    deferred,
    total,
    decisionRoot: hashOfHashes(payouts.flatMap((x) => x.decisionHashes)),
  };
}
