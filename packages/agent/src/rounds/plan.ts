import type { Address, Hex } from "viem";
import { hashOfHashes, payoutIdFor } from "./ids";

/** Must match MisthosVault.MAX_PAYOUTS_PER_ROUND. */
export const MAX_PAYOUTS_PER_ROUND = 200;

export interface PayableItem {
  submissionId: string;
  contributorId: string;
  contributorBytes32: Hex;
  /** The contributor's current payout wallet (from the DB). */
  wallet: Address;
  amount: bigint;
  decisionHash: Hex;
  createdAt: Date;
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
}

export type DeferReason =
  | "payee_not_registered"
  | "payee_cooldown"
  | "per_payout_cap"
  | "round_cap"
  | "daily_cap"
  | "too_many_payouts";

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
 * round total ≤ min(maxPerRound, maxPerDay − spentInWindow); ≤ 200 payouts. Whole submissions are never split:
 * anything that doesn't fit is deferred to a later round with a reason.
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
  const byContributor = new Map<string, PayableItem[]>();
  for (const it of [...p.items].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.submissionId.localeCompare(b.submissionId),
  )) {
    if (it.amount <= 0n) continue;
    byContributor.set(it.contributorId, [...(byContributor.get(it.contributorId) ?? []), it]);
  }
  // First come, first paid: contributors ordered by their earliest item.
  const order = [...byContributor.entries()];

  const roundRoom = (() => {
    const dayRoom = p.limits.maxPerDay - p.limits.spentInWindow;
    return dayRoom < p.limits.maxPerRound ? (dayRoom < 0n ? 0n : dayRoom) : p.limits.maxPerRound;
  })();
  const dailyBinds = p.limits.maxPerDay - p.limits.spentInWindow < p.limits.maxPerRound;

  const payouts: PlannedPayout[] = [];
  let total = 0n;
  for (const [contributorId, items] of order) {
    const first = items[0]!;
    const payee = p.payees.get(contributorId);
    const deferAll = (reason: DeferReason) =>
      items.forEach((i) => deferred.push({ submissionId: i.submissionId, reason }));
    if (!payee?.wallet || payee.wallet.toLowerCase() !== first.wallet.toLowerCase()) {
      deferAll("payee_not_registered");
      continue;
    }
    if (payee.payableAfter > p.nowSeconds) {
      deferAll("payee_cooldown");
      continue;
    }
    if (payouts.length >= MAX_PAYOUTS_PER_ROUND) {
      deferAll("too_many_payouts");
      continue;
    }

    const included: PayableItem[] = [];
    let sum = 0n;
    for (const it of items) {
      if (sum + it.amount > p.limits.maxPerPayout) {
        deferred.push({ submissionId: it.submissionId, reason: "per_payout_cap" });
        continue;
      }
      if (total + sum + it.amount > roundRoom) {
        deferred.push({
          submissionId: it.submissionId,
          reason: dailyBinds ? "daily_cap" : "round_cap",
        });
        continue;
      }
      included.push(it);
      sum += it.amount;
    }
    if (!included.length) continue;
    const hashes = included.map((i) => i.decisionHash);
    payouts.push({
      contributorId,
      contributorBytes32: first.contributorBytes32,
      payoutId: payoutIdFor(p.programBytes32, p.roundBytes32, first.contributorBytes32),
      to: first.wallet,
      amount: sum,
      decisionHash: hashOfHashes(hashes),
      submissionIds: included.map((i) => i.submissionId),
      decisionHashes: hashes,
    });
    total += sum;
  }
  return {
    payouts,
    deferred,
    total,
    decisionRoot: hashOfHashes(payouts.flatMap((x) => x.decisionHashes)),
  };
}
