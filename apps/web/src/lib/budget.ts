/** A campaign's money state, kept pure so the rules are testable without a chain or database. */

export const ENDED_MESSAGE = "This campaign has ended. Thanks for contributing!";
export const BUDGET_USED_UP_MESSAGE = "This campaign's budget is used up for now.";

export interface Budget {
  /** Vault balance minus every approved, unpaid amount; null when the balance couldn't be read. */
  available: bigint | null;
  /** Can't pay even one point: new submissions wait until the owner adds funds. */
  usedUp: boolean;
}

/**
 * Available budget = vault balance − approved, unpaid work (across all rounds). "Used up" when what's left can't pay a
 * single point. An unreadable balance never blocks anyone (the agent still won't auto-approve past it).
 */
export function budgetOf(p: {
  balance: bigint | null;
  approvedUnpaid: bigint;
  ratePerPoint: bigint;
}): Budget {
  if (p.balance === null) return { available: null, usedUp: false };
  const available = p.balance - p.approvedUnpaid;
  return { available, usedUp: available < (p.ratePerPoint > 0n ? p.ratePerPoint : 1n) };
}

/** Why a campaign isn't taking submissions right now, or null when it is. */
export function closedReason(p: { endedAt: Date | null; budget: Budget }): string | null {
  if (p.endedAt) return ENDED_MESSAGE;
  if (p.budget.usedUp) return BUDGET_USED_UP_MESSAGE;
  return null;
}
