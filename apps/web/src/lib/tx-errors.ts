import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/** What each vault revert means for the person who triggered it. */
const REVERTS: Record<string, string> = {
  NotOwner: "Only the vault owner can do this. Switch your wallet to the owner account.",
  NotOwnerOrGuardian: "Only the vault owner or guardian can pause it.",
  NotAgent: "Only the Misthos agent can do this.",
  ZeroAddress: "The address can't be empty.",
  ZeroAmount: "Enter an amount above zero.",
  IsPaused: "The vault is paused. Resume it first.",
  InvalidLimits:
    "Those limits don't fit together: per contributor ≤ per round ≤ per 24 hours, and none can be zero.",
  RoundNotProposed: "This round isn't waiting for approval any more. Refresh the page.",
  RoundNotExecutable: "This round can't be executed in its current state. Refresh the page.",
  ApprovalRequired: "This round is above your approval threshold and needs your approval first.",
  PayoutTooLarge: "A payout is above the per-contributor limit, so the vault refused it.",
  RoundTooLarge: "The round total is above the per-round limit, so the vault refused it.",
  DailyCapExceeded:
    "This would pass the rolling 24-hour limit. Try again later or raise the limit.",
  PayeeInCooldown: "A payout wallet is still in its cooldown period.",
  AlreadyPaid: "This payout was already made.",
};

/** Turn a wallet / RPC / contract error into one sentence a person can act on. */
export function humanizeTxError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError))
      return "You declined the request in your wallet.";
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && REVERTS[name]) return REVERTS[name];
      if (revert.reason) return `The contract refused this: ${revert.reason}.`;
    }
  }
  const msg =
    (e as { shortMessage?: string }).shortMessage ?? (e instanceof Error ? e.message : String(e));
  if (/user (rejected|denied)|rejected the request|request rejected|4001/i.test(msg))
    return "You declined the request in your wallet.";
  if (/insufficient funds|exceeds the balance|gas required exceeds/i.test(msg))
    return "Your wallet doesn't have enough USDC to cover this and the network fee.";
  if (/transfer amount exceeds (balance|allowance)|ERC20InsufficientBalance/i.test(msg))
    return "Not enough USDC in the wallet for this amount.";
  if (/chain mismatch|does not match the target chain|wrong network/i.test(msg))
    return "Your wallet is on another network. Switch to Arc and try again.";
  if (/timeout|timed out|network error|failed to fetch/i.test(msg))
    return "Couldn't reach the network. Check your connection and try again.";
  return msg.split("\n")[0]!.replace(/\.$/, "") + ".";
}
