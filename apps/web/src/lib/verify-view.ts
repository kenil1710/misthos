/**
 * The Verify stepper's states, as data. The five checks are known up front, so they show (waiting, with what each
 * one proves) before anything is pasted; while the server works the first check pulses; once the result is back the
 * checks are revealed one by one, so people can follow the chain instead of reading a wall of results.
 */

export type CheckId = "record" | "published" | "signature" | "payout" | "chain";
export type CheckState = "pass" | "fail" | "skip";
export type ViewStatus = "done" | "current" | "waiting" | "failed" | "skipped";

export const VERIFY_CHECKS: { id: CheckId; label: string; explains: string }[] = [
  {
    id: "record",
    label: "Record hash",
    explains: "Recompute the keccak256 hash of the canonical record (sorted keys, no whitespace).",
  },
  {
    id: "published",
    label: "Published by Misthos",
    explains: "Find the decision Misthos published with exactly that hash.",
  },
  {
    id: "signature",
    label: "Agent signature",
    explains:
      "Check the agent's signature over the hash (a wallet key or an ERC-1271 smart wallet).",
  },
  {
    id: "payout",
    label: "Included in a payout",
    explains: "Confirm the payout that paid it commits to this decision's hash.",
  },
  {
    id: "chain",
    label: "Matches the on-chain payout event",
    explains: "Read the payout transaction on Arc and match the vault's PayoutExecuted event.",
  },
];

export interface VerifyResultLike {
  steps: { id: string; state: CheckState }[];
}

const STATUS: Record<CheckState, ViewStatus> = { pass: "done", fail: "failed", skip: "skipped" };

/**
 * Status per check for the stepper. `revealed` is how many result steps are shown so far; the next one is "current"
 * while the reveal runs. With no result: the first check pulses while `busy`, otherwise all wait.
 */
export function verifyStatuses(
  result: VerifyResultLike | null,
  revealed: number,
  busy: boolean,
): ViewStatus[] {
  if (!result) return VERIFY_CHECKS.map((_, i) => (busy && i === 0 ? "current" : "waiting"));
  return VERIFY_CHECKS.map((c, i) => {
    const step = result.steps.find((s) => s.id === c.id);
    if (i < revealed) return step ? STATUS[step.state] : "skipped";
    return i === revealed ? "current" : "waiting";
  });
}

/** The reveal is finished once every check is shown. */
export const revealDone = (revealed: number) => revealed >= VERIFY_CHECKS.length;
