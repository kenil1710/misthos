import { formatUsdc, shortHex, SOURCE_LABEL } from "@misthos/shared";
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
  getPublicProgramCached as getPublicProgram,
  publicDecisionsCached as publicDecisions,
  publicPayoutsCached as publicPayouts,
  publicRoundsCached as publicRounds,
  publicStatsCached as publicStats,
} from "@/lib/server/public-cached";
import { explorerAddress, explorerTx } from "@/lib/server/vault";
import { PreviewBanner } from "@/components/app/preview-banner";
import { SealArt } from "@/components/brand/illustrations";

const PAID = new Set(["approve", "partial"]);
const ACTION_WORD: Record<string, string> = {
  approve: "approved",
  partial: "partly approved",
  reject: "rejected",
  escalate: "sent to review",
};
import { draftPreviewFor } from "@/lib/server/preview";
import { utc } from "@/lib/time";

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const slug = (await params).slug;
  // Same lookup as the page (a draft is visible to its owner as a preview). Resolved before streaming starts, so
  // an unknown program is a real 404 (status and title), not a 200.
  const p = (await getPublicProgram(slug)) ?? (await draftPreviewFor(slug));
  if (!p) notFound();
  return {
    title: p.status === "draft" ? `Preview: ${p.name} audit` : `${p.name} audit`,
    description: `Every payout ${p.name} made through Misthos, with verifiable decision records.`,
  };
}

export default async function PublicAuditPage({ params }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  const program = (await getPublicProgram(slug)) ?? (await draftPreviewFor(slug));
  if (!program) notFound();
  const preview = program.status === "draft";
  const [stats, rounds, payouts, recent] = await Promise.all([
    publicStats(program.id),
    publicRounds(program.id),
    publicPayouts(program.id),
    publicDecisions(program.id, 20),
  ]);

  const quiet = stats.reviewed === 0 && payouts.length === 0;

  return (
    <>
      {preview ? (
        <div className="-mx-4 -mt-10 sm:-mx-6">
          <PreviewBanner programId={program.id} what="audit page" />
        </div>
      ) : null}
      <header className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-brand text-sm font-medium">Public audit</p>
          {program.isDemo ? (
            <span className="bg-warning-subtle text-warning rounded-md px-1.5 py-0.5 text-xs font-medium">
              Demo program: excluded from Misthos metrics
            </span>
          ) : null}
        </div>
        <h1 className="display text-[2.75rem] leading-[1.02] [overflow-wrap:anywhere] sm:text-[4rem]">
          {program.name}
        </h1>
        <p className="text-soft max-w-[62ch] text-[17px] leading-relaxed">{program.description}</p>
        {/* Stacked on phones: the address is monospace (loaded late), so a shared row could re-wrap as it loads. */}
        <div className="text-muted-foreground flex flex-col items-start gap-3 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
          {program.vaultAddress ? (
            <span className="bg-card shadow-soft inline-flex items-center gap-2 rounded-full px-3.5 py-1.5">
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

      {quiet ? (
        <section
          className="bg-card shadow-soft grid items-center gap-6 rounded-[1.5rem] p-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:p-8"
          aria-labelledby="quiet-h"
        >
          <SealArt className="size-20 sm:size-24" />
          <div>
            <h2 id="quiet-h" className="display text-[1.75rem] leading-tight">
              Nothing to audit yet
            </h2>
            <p className="text-soft mt-2 max-w-2xl text-sm leading-relaxed">
              This program hasn&apos;t reviewed any work yet. As soon as the agent decides on a
              submission, its signed decision record appears here, and every payout shows the
              transaction on Arc and the decisions it paid for.
            </p>
          </div>
        </section>
      ) : null}

      <section
        className={quiet ? "hidden" : "grid grid-cols-2 gap-3 lg:grid-cols-5"}
        aria-label="Program totals"
      >
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

      <section className="grid gap-5" aria-labelledby="verify-h">
        <div>
          <h2 id="verify-h" className="display text-[2rem] leading-tight sm:text-[2.5rem]">
            Verify a decision
          </h2>
          <p className="text-soft mt-2 max-w-[62ch] text-[15px] leading-relaxed">
            Every agent decision is a signed record. Check one yourself: the hash, the signature,
            and the payment on Arc.
          </p>
        </div>
        <div id="verify" className="scroll-mt-6">
          <VerifyTool
            // Paid or approved decisions first: they verify all the way to the transaction on Arc.
            picks={[...recent]
              .sort((a, b) => Number(PAID.has(b.action)) - Number(PAID.has(a.action)))
              .slice(0, 4)
              .map((d) => ({
                hash: d.hash,
                label: `@${d.handle} · ${ACTION_WORD[d.action] ?? d.action}${
                  BigInt(d.amount) > 0n ? ` · ${formatUsdc(BigInt(d.amount))}` : ""
                }`,
              }))}
          />
        </div>
      </section>

      <Section
        title="Payouts"
        description="Each payout's decision hash commits to the decision records it pays for."
      >
        {payouts.length === 0 ? (
          <EmptyState art="coins" title="No payouts yet">
            They appear here as soon as a round is paid, each with its transaction on Arc.
          </EmptyState>
        ) : (
          <TableFrame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contributor</TableHead>
                  <TableHead>Round</TableHead>
                  <TableHead className="text-right">Amount (USDC)</TableHead>
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
          <EmptyState art="stack" title="No rounds yet">
            Rounds appear once the first one starts.
          </EmptyState>
        ) : (
          <TableFrame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Round</TableHead>
                  <TableHead>Window (UTC)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Payouts</TableHead>
                  <TableHead className="text-right">Total (USDC)</TableHead>
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
                    <TableCell className="mono-num text-right">
                      {r.status === "executed" ? r.paidCount : "—"}
                    </TableCell>
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
          <EmptyState art="seal" title="No decisions yet">
            Each decision the agent makes appears here with its signed record.
          </EmptyState>
        ) : (
          <ul className="grid items-start gap-3 md:grid-cols-2">
            {recent.map((d) => (
              <li
                key={d.hash}
                className="bg-card shadow-soft grid content-start gap-2.5 rounded-[1.25rem] p-5"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <ActionBadge action={d.action} />
                  <span className="font-medium">@{d.handle}</span>
                  <span className="text-muted-foreground">{SOURCE_LABEL[d.sourceType]}</span>
                  <span className="text-muted-foreground mono-num ml-auto text-xs">
                    {utc(d.createdAt)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed">{d.summary}</p>
                {d.decidedBy === "human" ? (
                  <p className="text-muted-foreground text-xs">Decided by the program team</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-4 border-t pt-3 text-[13px]">
                  <span className="text-muted-foreground font-mono">{shortHex(d.hash, 8, 6)}</span>
                  <a
                    href={`#verify?d=${d.hash}`}
                    title="Check this decision record against the payment on Arc"
                    className="text-brand font-medium underline-offset-4 hover:underline"
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
