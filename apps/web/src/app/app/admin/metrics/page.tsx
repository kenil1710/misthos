import { formatUsdc } from "@misthos/shared";
import { notFound } from "next/navigation";
import { PageHeader, Section, Stat } from "@/components/ui-kit";
import { isFounder } from "@/lib/server/founders";
import { computeMetrics, type Metrics } from "@/lib/server/metrics";
import { getOwnerSession } from "@/lib/server/session";
import { CopyMetrics } from "./copy-button";

export const metadata = { title: "Metrics" };

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const duration = (s: number | null) =>
  s === null
    ? "—"
    : s < 90
      ? `${Math.round(s)} s`
      : s < 5400
        ? `${Math.round(s / 60)} min`
        : `${(s / 3600).toFixed(1)} h`;
const FLAG_LABELS: Record<string, string> = {
  NEAR_DUPLICATE: "Copied content",
  DUPLICATE_URL: "Duplicate link",
  OWNERSHIP_MISMATCH: "Someone else's work",
  OUT_OF_WINDOW: "Outside the round",
  PROMPT_INJECTION_ATTEMPT: "Prompt injection",
  DELETED: "Deleted",
  NOT_MERGED: "Unmerged PR",
};

function asText(m: Metrics): string {
  const fraud = Object.values(m.fraudByFlag).reduce((a, b) => a + b, 0);
  return [
    `Programs onboarded: ${m.programsOnboarded} (${m.programsActive} active)`,
    `Contributors: ${m.contributors} joined, ${m.activeContributors30d} active in the last 30 days`,
    `Submissions reviewed by the agent: ${m.submissionsReviewed}`,
    `Auto-approved: ${pct(m.autoApprovedPct)}; escalated to a human: ${pct(m.escalatedPct)}`,
    `Fraud and duplicates caught: ${fraud}${
      fraud
        ? ` (${Object.entries(m.fraudByFlag)
            .map(([k, v]) => `${FLAG_LABELS[k] ?? k} ${v}`)
            .join(", ")})`
        : ""
    }`,
    `USDC paid: ${formatUsdc(m.usdcPaidMainnet)} on Arc mainnet, ${formatUsdc(m.usdcPaidTestnet)} on Arc testnet, to ${m.contributorsPaid} contributors`,
    `Rounds executed: ${m.roundsExecuted}`,
    `Median review time: ${duration(m.medianReviewSeconds)}`,
    `X API spend: $${m.xSpendUsd.toFixed(2)} (${m.xCalls} lookups); LLM spend: $${m.llmSpendUsd.toFixed(2)}`,
    "Demo programs excluded. Computed from database rows and on-chain payouts.",
  ].join("\n");
}

export default async function MetricsPage() {
  const session = await getOwnerSession();
  if (!(await isFounder(session))) notFound();
  const m = await computeMetrics();
  const fraudTotal = Object.values(m.fraudByFlag).reduce((a, b) => a + b, 0);
  return (
    <div className="grid gap-8">
      <PageHeader
        title="Metrics"
        description="Real programs only. Demo programs are excluded from every number on this page."
        actions={<CopyMetrics text={asText(m)} />}
      />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Programs onboarded"
          value={m.programsOnboarded}
          hint={`${m.programsActive} active`}
        />
        <Stat
          label="Contributors"
          value={m.contributors}
          hint={`${m.activeContributors30d} active in 30 days`}
        />
        <Stat label="Submissions reviewed" value={m.submissionsReviewed} />
        <Stat label="Fraud and duplicates caught" value={fraudTotal} />
        <Stat label="Auto-approved" value={pct(m.autoApprovedPct)} />
        <Stat label="Escalated to a human" value={pct(m.escalatedPct)} />
        <Stat label="Median review time" value={duration(m.medianReviewSeconds)} />
        <Stat label="Rounds executed" value={m.roundsExecuted} />
      </section>
      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="USDC paid">
          <dl className="bg-card grid grid-cols-[1fr_auto] gap-y-2 rounded-lg border p-4 text-sm">
            <dt className="text-muted-foreground">Arc mainnet</dt>
            <dd className="mono-num">{formatUsdc(m.usdcPaidMainnet)}</dd>
            <dt className="text-muted-foreground">Arc testnet</dt>
            <dd className="mono-num">{formatUsdc(m.usdcPaidTestnet)}</dd>
            <dt className="text-muted-foreground">Contributors paid</dt>
            <dd className="mono-num">{m.contributorsPaid}</dd>
          </dl>
        </Section>
        <Section title="Caught by flag">
          <dl className="bg-card grid grid-cols-[1fr_auto] gap-y-2 rounded-lg border p-4 text-sm">
            {Object.keys(m.fraudByFlag).length === 0 ? (
              <dd className="text-muted-foreground col-span-2">Nothing caught yet.</dd>
            ) : (
              Object.entries(m.fraudByFlag).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{FLAG_LABELS[k] ?? k}</dt>
                  <dd className="mono-num">{v}</dd>
                </div>
              ))
            )}
          </dl>
        </Section>
        <Section title="API spend">
          <dl className="bg-card grid grid-cols-[1fr_auto] gap-y-2 rounded-lg border p-4 text-sm">
            <dt className="text-muted-foreground">X API ({m.xCalls} lookups)</dt>
            <dd className="mono-num">${m.xSpendUsd.toFixed(2)}</dd>
            <dt className="text-muted-foreground">Claude Haiku 4.5</dt>
            <dd className="mono-num">${m.llmSpendUsd.toFixed(2)}</dd>
          </dl>
        </Section>
      </div>
    </div>
  );
}
