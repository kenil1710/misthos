import { formatUsdc, shortHex, SOURCE_LABELS } from "@misthos/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RoundStatus } from "@/components/app/round-status";
import { HexValue } from "@/components/hex-value";
import { ActionBadge } from "@/components/public/action-badge";
import { VerifyTool } from "@/components/public/verify-tool";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, Section, Stat, TableFrame } from "@/components/ui-kit";
import {
  getPublicProgram,
  publicDecisions,
  publicPayouts,
  publicRounds,
  publicStats,
} from "@/lib/server/public";
import { explorerAddress, explorerTx } from "@/lib/server/vault";

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const p = await getPublicProgram((await params).slug);
  return p
    ? {
        title: `${p.name} audit`,
        description: `Every payout ${p.name} made through Misthos, with verifiable decision records.`,
      }
    : {};
}

export default async function PublicAuditPage({ params }: PageProps<"/p/[slug]">) {
  const program = await getPublicProgram((await params).slug);
  if (!program) notFound();
  const [stats, rounds, payouts, recent] = await Promise.all([
    publicStats(program.id),
    publicRounds(program.id),
    publicPayouts(program.id),
    publicDecisions(program.id, 20),
  ]);

  return (
    <>
      <header className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{program.name}</h1>
          {program.isDemo ? (
            <span className="bg-warning-subtle text-warning rounded-md px-1.5 py-0.5 text-xs font-medium">
              Demo program: excluded from Misthos metrics
            </span>
          ) : null}
        </div>
        <p className="text-muted-foreground max-w-2xl">{program.description}</p>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {program.vaultAddress ? (
            <span className="inline-flex items-center gap-2">
              Vault{" "}
              <HexValue
                value={program.vaultAddress}
                label="vault address"
                href={explorerAddress(program.vaultAddress)}
              />
            </span>
          ) : null}
          {program.status === "active" ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/join/${program.slug}`}>Join this program</Link>
            </Button>
          ) : null}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Program totals">
        <Stat
          label="USDC paid"
          value={formatUsdc(stats.usdcPaid, { withSymbol: false })}
          hint="USDC on Arc"
        />
        <Stat label="Contributors paid" value={stats.contributorsPaid} />
        <Stat label="Submissions reviewed" value={stats.reviewed} />
        <Stat label="Fraud caught" value={stats.fraudCaught} hint="copied, not theirs, or gamed" />
        <Stat label="Rounds paid" value={stats.roundsPaid} />
      </section>

      <Section
        title="Verify a decision"
        description="Every agent decision is a signed record. Check one yourself: the hash, the signature, and the payment on Arc."
      >
        <div id="verify" className="scroll-mt-6">
          <VerifyTool />
        </div>
      </Section>

      <Section
        title="Payouts"
        description="Each payout's decision hash commits to the decision records it pays for."
      >
        {payouts.length === 0 ? (
          <EmptyState>No payouts yet. They appear here as soon as a round executes.</EmptyState>
        ) : (
          <TableFrame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contributor</TableHead>
                  <TableHead>Round</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Decision hash</TableHead>
                  <TableHead>Transaction</TableHead>
                  <TableHead className="text-right">Records</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>@{p.handle}</TableCell>
                    <TableCell>
                      <Link
                        href={`/p/${program.slug}/rounds/${p.roundId}`}
                        className="hover:underline"
                      >
                        Round {p.roundNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="mono-num text-right">
                      {formatUsdc(p.amount, { withSymbol: false })}
                    </TableCell>
                    <TableCell>
                      <HexValue value={p.decisionHash} label="payout decision hash" />
                    </TableCell>
                    <TableCell>
                      {p.txHash ? (
                        <HexValue
                          value={p.txHash}
                          label="transaction hash"
                          href={explorerTx(p.txHash)}
                        />
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {p.items.map((i, n) =>
                          i.decisionHash ? (
                            <a
                              key={i.submissionId}
                              href={`#verify?d=${i.decisionHash}`}
                              title="Check this decision record against the payment on Arc"
                              className="text-[13px] underline underline-offset-4"
                            >
                              Verify{p.items.length > 1 ? ` ${n + 1}` : ""}
                            </a>
                          ) : null,
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableFrame>
        )}
      </Section>

      <Section title="Rounds">
        {rounds.length === 0 ? (
          <EmptyState>No rounds yet.</EmptyState>
        ) : (
          <TableFrame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Round</TableHead>
                  <TableHead>Window (UTC)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rounds.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        href={`/p/${program.slug}/rounds/${r.id}`}
                        className="font-medium hover:underline"
                      >
                        Round {r.number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground mono-num">
                      {r.startsAt.toISOString().slice(0, 10)} to{" "}
                      {r.endsAt.toISOString().slice(0, 10)}
                    </TableCell>
                    <TableCell>
                      <RoundStatus status={r.status} />
                    </TableCell>
                    <TableCell className="mono-num text-right">{r.paidCount}</TableCell>
                    <TableCell className="mono-num text-right">
                      {r.totalAmount > 0n ? formatUsdc(r.totalAmount, { withSymbol: false }) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableFrame>
        )}
      </Section>

      <Section title="Recent decisions" description="What the agent decided and why, newest first.">
        {recent.length === 0 ? (
          <EmptyState>No decisions yet.</EmptyState>
        ) : (
          <ul className="divide-y rounded-lg border">
            {recent.map((d) => (
              <li key={d.hash} className="grid gap-1.5 p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <ActionBadge action={d.action} />
                  <span>@{d.handle}</span>
                  <span className="text-muted-foreground">
                    {SOURCE_LABELS[d.sourceType].replace(/s$/, "")}
                  </span>
                  {d.decidedBy === "human" ? (
                    <span className="text-muted-foreground">decided by the program team</span>
                  ) : null}
                  <span className="text-muted-foreground ml-auto mono-num text-xs">
                    {d.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                  </span>
                </div>
                <p className="text-sm">{d.summary}</p>
                <div className="flex flex-wrap items-center gap-4 text-[13px]">
                  <span className="text-muted-foreground font-mono">{shortHex(d.hash, 8, 6)}</span>
                  <a
                    href={`#verify?d=${d.hash}`}
                    title="Check this decision record against the payment on Arc"
                    className="underline underline-offset-4"
                  >
                    Verify
                  </a>
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground underline-offset-4 hover:underline"
                  >
                    Submitted work
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
