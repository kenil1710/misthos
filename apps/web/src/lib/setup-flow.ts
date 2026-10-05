/**
 * The guided "go live" flow after creating a program: deploy the vault, fund it, publish the join page. Pure, so the
 * "Your program is ready" screen, the setup flow and the overview tell the same story.
 */

export type SetupKey = "deploy" | "fund" | "publish";
export type SetupStatus = "done" | "current" | "waiting";

export interface SetupState {
  vaultDeployed: boolean;
  /** Anything was ever deposited (a vault drained by payouts still counts as funded). */
  funded: boolean;
  published: boolean;
}

export const SETUP_STEPS: { key: SetupKey; label: string }[] = [
  { key: "deploy", label: "Deploy the vault" },
  { key: "fund", label: "Fund the vault" },
  { key: "publish", label: "Publish the join page" },
];

/** The first unfinished step, in order, or "live" once all three are done. */
export function setupCurrent(s: SetupState): SetupKey | "live" {
  if (!s.vaultDeployed) return "deploy";
  if (!s.funded) return "fund";
  if (!s.published) return "publish";
  return "live";
}

export function setupSteps(s: SetupState): { key: SetupKey; label: string; status: SetupStatus }[] {
  const done: Record<SetupKey, boolean> = {
    deploy: s.vaultDeployed,
    fund: s.funded,
    publish: s.published,
  };
  const current = setupCurrent(s);
  return SETUP_STEPS.map((step) => ({
    ...step,
    status: done[step.key] ? "done" : step.key === current ? "current" : "waiting",
  }));
}

/**
 * Deposit suggestions for the fund step, from the program's own limits: one round at the per-round cap, and two
 * rounds. Nothing when the cap is unknown or zero.
 */
export function fundSuggestions(maxPerRound: bigint): { label: string; amount: bigint }[] {
  if (maxPerRound <= 0n) return [];
  return [
    { label: "One full round", amount: maxPerRound },
    { label: "Two rounds", amount: maxPerRound * 2n },
  ];
}
