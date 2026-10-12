import { formatUsdc } from "@misthos/shared";
import { notFound } from "next/navigation";
import type { ChainKey } from "@misthos/shared/chains";
import { NetworkBadge } from "@/components/network-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader, Section, TableFrame } from "@/components/ui-kit";
import { selectedNetwork } from "@/lib/server/network";
import { isFounder } from "@/lib/server/founders";
import { computeMetrics, type Metrics } from "@/lib/server/metrics";
import {
  asText,
  duration,
  FLAG_LABELS,
  fraudTotal,
  NETWORK_NAME as NAME,
  pct,
} from "@/lib/metrics-text";
import { getOwnerSession } from "@/lib/server/session";
import { CopyMetrics } from "./copy-button";

export const metadata = { title: "Metrics" };

type Row = { label: string; value: (m: Metrics, chain: ChainKey) => string | number };
const ROWS: Row[] = [
  {
    label: "Programs onboarded",
    value: (m) => `${m.programsOnboarded} (${m.programsActive} active)`,
  },
  { label: "Contributors", value: (m) => m.contributors },
  { label: "Active in 30 days", value: (m) => m.activeContributors30d },
  { label: "Submissions reviewed", value: (m) => m.submissionsReviewed },
  { label: "Fraud and duplicates caught", value: (m) => fraudTotal(m) },
  { label: "Auto-approved", value: (m) => pct(m.autoApprovedPct) },
  { label: "Escalated to a human", value: (m) => pct(m.escalatedPct) },
  { label: "Median review time", value: (m) => duration(m.medianReviewSeconds) },
  { label: "Rounds executed", value: (m) => m.roundsExecuted },
  {
    label: "USDC paid",
    value: (m, c) => formatUsdc(c === "arc-mainnet" ? m.usdcPaidMainnet : m.usdcPaidTestnet),
  },
  { label: "Contributors paid", value: (m) => m.contributorsPaid },
  { label: "X API spend", value: (m) => `$${m.xSpendUsd.toFixed(2)} (${m.xCalls})` },
  { label: "Claude Haiku 4.5 spend", value: (m) => `$${m.llmSpendUsd.toFixed(2)}` },
];

export default async function MetricsPage() {
  const session = await getOwnerSession();
  if (!(await isFounder(session))) notFound();
  const [testnet, mainnet, selected] = await Promise.all([
    computeMetrics(undefined, "arc-testnet"),
    computeMetrics(undefined, "arc-mainnet"),
    selectedNetwork(),
  ]);
  const by: Record<ChainKey, Metrics> = { "arc-testnet": testnet, "arc-mainnet": mainnet };
  // The header's network first; the other one next to it.
  const order: ChainKey[] =
    selected === "arc-mainnet" ? ["arc-mainnet", "arc-testnet"] : ["arc-testnet", "arc-mainnet"];
  const flags = [...new Set(order.flatMap((c) => Object.keys(by[c].fraudByFlag)))];
  return (
    <div className="grid gap-8">
      <PageHeader
        title="Metrics"
        description="Real programs only, Arc Testnet and Arc Mainnet apart. Demo programs are excluded from every number on this page."
        actions={<CopyMetrics text={asText(by)} />}
      />
      <TableFrame>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              {order.map((c) => (
                <TableHead key={c} className="text-right">
                  <span className="inline-flex items-center gap-2">
                    <NetworkBadge chain={c} short />
                    {c === selected ? <span className="sr-only">(selected)</span> : null}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((r) => (
              <TableRow key={r.label}>
                <TableCell className="text-muted-foreground">{r.label}</TableCell>
                {order.map((c) => (
                  <TableCell key={c} className="mono-num text-right">
                    {r.value(by[c], c)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableFrame>
      <Section title="Caught by flag">
        {flags.length === 0 ? (
          <p className="bg-card text-muted-foreground rounded-lg border p-4 text-sm">
            Nothing caught yet.
          </p>
        ) : (
          <TableFrame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Flag</TableHead>
                  {order.map((c) => (
                    <TableHead key={c} className="text-right">
                      {NAME[c]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {flags.map((k) => (
                  <TableRow key={k}>
                    <TableCell className="text-muted-foreground">{FLAG_LABELS[k] ?? k}</TableCell>
                    {order.map((c) => (
                      <TableCell key={c} className="mono-num text-right">
                        {by[c].fraudByFlag[k] ?? 0}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableFrame>
        )}
      </Section>
    </div>
  );
}
