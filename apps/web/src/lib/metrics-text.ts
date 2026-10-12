import { formatUsdc } from "@misthos/shared/money";
import type { ChainKey } from "@misthos/shared/chains";
import type { Metrics } from "@/lib/server/metrics";

export const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
export const duration = (s: number | null) =>
  s === null
    ? "—"
    : s < 90
      ? `${Math.round(s)} s`
      : s < 5400
        ? `${Math.round(s / 60)} min`
        : `${(s / 3600).toFixed(1)} h`;
export const FLAG_LABELS: Record<string, string> = {
  NEAR_DUPLICATE: "Copied content",
  DUPLICATE_URL: "Duplicate link",
  OWNERSHIP_MISMATCH: "Someone else's work",
  OUT_OF_WINDOW: "Outside the round",
  PROMPT_INJECTION_ATTEMPT: "Prompt injection",
  DELETED: "Deleted",
  NOT_MERGED: "Unmerged PR",
};

export const NETWORK_NAME: Record<ChainKey, string> = {
  "arc-testnet": "Arc Testnet",
  "arc-mainnet": "Arc Mainnet",
};
export const fraudTotal = (m: Metrics) => Object.values(m.fraudByFlag).reduce((a, b) => a + b, 0);

/** One network's lines for the submission form. */
function networkLines(chain: ChainKey, m: Metrics): string[] {
  const fraud = fraudTotal(m);
  const paid = chain === "arc-mainnet" ? m.usdcPaidMainnet : m.usdcPaidTestnet;
  return [
    `${NETWORK_NAME[chain]}${chain === "arc-mainnet" ? " (real USDC)" : " (test USDC)"}:`,
    `- Programs onboarded: ${m.programsOnboarded} (${m.programsActive} active)`,
    `- Contributors: ${m.contributors} joined, ${m.activeContributors30d} active in the last 30 days`,
    `- Submissions reviewed by the agent: ${m.submissionsReviewed}`,
    `- Auto-approved: ${pct(m.autoApprovedPct)}; escalated to a human: ${pct(m.escalatedPct)}`,
    `- Fraud and duplicates caught: ${fraud}${
      fraud
        ? ` (${Object.entries(m.fraudByFlag)
            .map(([k, v]) => `${FLAG_LABELS[k] ?? k} ${v}`)
            .join(", ")})`
        : ""
    }`,
    `- USDC paid: ${formatUsdc(paid)} to ${m.contributorsPaid} contributors`,
    `- Rounds executed: ${m.roundsExecuted}`,
    `- Median review time: ${duration(m.medianReviewSeconds)}`,
    `- X API spend: $${m.xSpendUsd.toFixed(2)} (${m.xCalls} lookups); LLM spend: $${m.llmSpendUsd.toFixed(2)}`,
  ];
}

/** "Copy for submission form": Arc Mainnet and Arc Testnet reported apart, never added together. */
export function asText(by: Record<ChainKey, Metrics>): string {
  return [
    ...networkLines("arc-mainnet", by["arc-mainnet"]),
    "",
    ...networkLines("arc-testnet", by["arc-testnet"]),
    "",
    "Demo programs excluded. Computed from database rows and on-chain payouts.",
  ].join("\n");
}
