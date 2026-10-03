import { formatUsdc } from "@misthos/shared";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Address } from "viem";
import { z } from "zod";
import { ProgramStatus } from "@/components/app/program-status";
import { SetupChecklist, type SetupStep } from "@/components/app/setup-checklist";
import { Button } from "@/components/ui/button";
import { Card, Notice, PageHeader, Stat } from "@/components/ui-kit";
import { CopyField } from "@/components/ui-kit/copy-field";
import { Term } from "@/components/ui-kit/term";
import { DeployVault, FundVault, OwnerWallet } from "@/components/vault/islands";
import { currentRound } from "@/lib/rounds";
import { appOrigin } from "@/lib/server/env";
import { getProgramForMember, getRounds, submissionCounts } from "@/lib/server/queries";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { programSummary } from "@/lib/server/program-summary";
import { programStatusLine } from "@/lib/status-line";
import { JoinPagePreview, NeedsYou } from "@/components/app/program-home";
import { CopyButton } from "@/components/ui-kit/copy-button";
import { getOwnerSession, type OwnerSession } from "@/lib/server/session";
import { agentAddress, factoryAddress, programIdBytes32, usdcAddress } from "@/lib/server/vault";
import { PublishButton } from "./publish-button";
import { ShareOnX } from "@/components/app/share-on-x";
import { shareOnXUrl } from "@/lib/share";

/**
 * The header (name, description, status) renders from one quick query and streams first; everything that needs
 * vault reads and counts streams in behind it, so the page paints fast even when Arc's RPC is slow.
 */
export default async function ProgramPage({ params }: PageProps<"/app/programs/[id]">) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const row = await getProgramForMember(id, session.sub);
  if (!row) notFound();
  const { program, role } = row;
  const published = program.status === "active" || program.status === "paused";
  return (
    <div className="grid gap-8">
      <PageHeader
        title={program.name}
        meta={<ProgramStatus status={program.status} />}
        description={program.description}
        actions={
          <>
            {role === "owner" ? <OwnerWallet owner={session.addr} /> : null}
            {published ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/p/${program.slug}`} target="_blank">
                  Public audit page
                  <ArrowUpRight className="size-3.5" strokeWidth={1.5} />
                </Link>
              </Button>
            ) : null}
            {role === "owner" && published ? (
              <PublishButton programId={program.id} status={program.status} />
            ) : null}
          </>
        }
      />
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewBody id={id} session={session} />
      </Suspense>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="-mt-2 grid gap-8" aria-busy="true" aria-label="Loading program">
      <Skeleton className="h-[52px] rounded-xl" />
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

async function OverviewBody({ id, session }: { id: string; session: OwnerSession }) {
  const summary = await programSummary(id, session.sub);
  if (!summary) notFound();
  const { program, role } = summary;
  const isOwner = role === "owner";
  const [rounds, counts] = await Promise.all([getRounds(program.id), submissionCounts(program.id)]);
  const total = summary.submissions;
  const limits = program.limitsJson;
  const joinUrl = `${appOrigin()}/join/${program.slug}`;
  const agent = agentAddress();
  const vault = program.vaultAddress as Address | null;
  const vaultState = summary.vault;
  const current = currentRound(rounds);
  const published = program.status === "active" || program.status === "paused";
  const needsReview = counts.escalated ?? 0;
  const approvedUnpaid = (counts.approved ?? 0) + (counts.partial ?? 0);
  const base = `/app/programs/${program.id}`;
  const shareHref = shareOnXUrl({
    name: program.name,
    joinUrl,
    sources: [...new Set(program.rubricJson.categories.flatMap((c) => c.sourceTypes))],
    bestPayout: program.rubricJson.categories.reduce(
      (m, c) =>
        program.ratePerPoint * BigInt(c.maxPoints) > m
          ? program.ratePerPoint * BigInt(c.maxPoints)
          : m,
      0n,
    ),
  });

  const steps: SetupStep[] = [
    {
      key: "deploy",
      title: "Deploy the vault",
      done: !!vault,
      description: (
        <>
          One transaction creates this program&apos;s <Term k="vault">vault</Term>. You own it; the{" "}
          <Term k="agent">agent</Term> can only pay out inside your limits.
        </>
      ),
      doneNote: "Vault deployed.",
      action:
        isOwner && agent ? (
          <DeployVault
            programId={program.id}
            factory={factoryAddress()}
            programIdBytes32={programIdBytes32(program.id)}
            owner={session.addr as Address}
            agent={agent}
            limits={{
              maxPerPayout: limits.maxPerPayout,
              maxPerRound: limits.maxPerRound,
              maxPerDay: limits.maxPerDay,
              autoApproveThreshold: limits.autoApproveThreshold,
              payeeCooldown: String(limits.payeeCooldownSeconds),
            }}
          />
        ) : !agent ? (
          <Notice tone="danger">
            The agent wallet isn&apos;t configured on this server (CIRCLE_AGENT_WALLET_ADDRESS).
          </Notice>
        ) : (
          <p className="text-muted-foreground text-sm">Only the owner can deploy the vault.</p>
        ),
    },
    {
      key: "fund",
      title: "Fund the vault",
      done: !!vaultState && vaultState.totalDeposited > 0n,
      description:
        "Deposit the USDC this program will pay out. You can withdraw unused funds at any time.",
      doneNote: vaultState ? `${formatUsdc(vaultState.balance)} in the vault.` : undefined,
      action:
        isOwner && vault ? (
          <FundVault
            programId={program.id}
            vault={vault}
            usdc={usdcAddress()}
            owner={session.addr as Address}
          />
        ) : null,
    },
    {
      key: "share",
      title: "Publish and share the join link",
      done: published,
      description: "Open the join page so contributors can sign up.",
      action: isOwner ? (
        <PublishButton programId={program.id} status={program.status} size="default" />
      ) : null,
    },
  ];

  // Publishing is allowed at any time: the status bar offers it unless the checklist is already showing it.
  const shareIsNext = steps.findIndex((s) => !s.done) === 2;
  const setupDone = steps.every((s) => s.done);
  const line = programStatusLine({
    status: program.status,
    round: summary.round,
    submissions: total,
    readyToPay: summary.readyToPay,
  });

  return (
    <div className="-mt-2 grid gap-8">
      <section
        aria-label="Status"
        className="bg-card flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border px-4 py-3 sm:px-5"
      >
        <p className="text-sm">
          {line.map((part, i) => (
            <span key={part}>
              {i ? <span className="text-muted-foreground">{" · "}</span> : null}
              <span className={i === 0 ? "font-medium" : "text-soft"}>{part}</span>
            </span>
          ))}
        </p>
        {published ? (
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton value={joinUrl} label="Copy join link" />
            <ShareOnX href={shareHref} />
          </div>
        ) : isOwner && !shareIsNext ? (
          <PublishButton programId={program.id} status={program.status} />
        ) : null}
      </section>

      {setupDone || summary.needs.length ? <NeedsYou items={summary.needs} /> : null}

      <SetupChecklist steps={steps} />

      {setupDone && total === 0 ? (
        <section
          aria-labelledby="first-h"
          className="bg-card grid gap-6 rounded-xl border p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px]"
        >
          <div className="grid content-start gap-4">
            <div>
              <h2 id="first-h" className="text-base font-medium">
                Get your first submissions
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Contributors join with this link, sign in with X and paste links to their work. The
                agent reviews each one in about a minute; you&apos;ll see it here.
              </p>
            </div>
            <CopyField
              value={joinUrl}
              label="join link"
              display={joinUrl.replace(/^https?:\/\//, "")}
            />
            <div className="flex flex-wrap gap-2">
              <ShareOnX href={shareHref} size="default" />
              <Button asChild variant="ghost">
                <Link href={`/join/${program.slug}`} target="_blank">
                  Open the join page
                  <ArrowUpRight className="size-3.5" strokeWidth={1.5} />
                </Link>
              </Button>
            </div>
          </div>
          <JoinPagePreview
            name={program.name}
            description={program.description}
            categories={program.rubricJson.categories.map((c) => ({
              key: c.key,
              name: c.name,
              payout: program.ratePerPoint * BigInt(c.maxPoints),
            }))}
          />
        </section>
      ) : null}

      {total > 0 ? (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Program totals">
          <Stat
            label="Vault balance"
            value={vaultState ? formatUsdc(vaultState.balance, { withSymbol: false }) : "—"}
            hint={vaultState ? "USDC" : "Vault not deployed"}
          />
          <Stat label="Contributors" value={summary.contributors} hint="Joined" />
          <Stat
            label="Needs review"
            value={needsReview}
            hint={
              needsReview ? (
                <Link
                  href={`${base}/submissions?status=escalated`}
                  className="text-foreground underline underline-offset-4"
                >
                  Review now
                </Link>
              ) : (
                "Nothing waiting for you"
              )
            }
          />
          <Stat
            label="Ready to pay"
            value={formatUsdc(summary.readyToPay, { withSymbol: false })}
            hint={
              current?.status === "open"
                ? `USDC from ${approvedUnpaid} approved item${approvedUnpaid === 1 ? "" : "s"}, paid when round ${current.number} closes`
                : `USDC from ${approvedUnpaid} approved item${approvedUnpaid === 1 ? "" : "s"}`
            }
          />
        </section>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
        <Card
          title="What this program pays for"
          description="The agent scores each submission against these categories."
        >
          <ul className="divide-y">
            {program.rubricJson.categories.map((c) => (
              <li key={c.key} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-medium">{c.name}</span>
                  <span className="mono-num text-sm">
                    up to {formatUsdc(program.ratePerPoint * BigInt(c.maxPoints))}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-sm">{c.description}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Scored on {c.criteria.map((k) => k.name.toLowerCase()).join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </Card>
        <Card
          title="Vault limits"
          description="Enforced by the contract, whatever the agent decides."
          actions={
            isOwner ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={`${base}/settings#limits`}>Edit</Link>
              </Button>
            ) : null
          }
        >
          <dl className="grid gap-2.5 text-sm">
            {(
              [
                ["Per contributor per round", formatUsdc(BigInt(limits.maxPerPayout))],
                ["Per round", formatUsdc(BigInt(limits.maxPerRound))],
                ["Per 24 hours", formatUsdc(BigInt(limits.maxPerDay))],
                [
                  <Term key="t" k="approvalThreshold">
                    Your approval above
                  </Term>,
                  formatUsdc(BigInt(limits.autoApproveThreshold)),
                ],
                [
                  <Term key="c" k="cooldown">
                    New wallet cooldown
                  </Term>,
                  `${limits.payeeCooldownSeconds / 3600} h`,
                ],
              ] as const
            ).map(([label, value], i) => (
              <div key={i} className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="mono-num">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
