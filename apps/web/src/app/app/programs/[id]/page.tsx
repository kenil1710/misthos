import { formatUsdc } from "@misthos/shared";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Address } from "viem";
import { z } from "zod";
import { ProgramStatus } from "@/components/app/program-status";
import {
  SetupChecklist,
  SetupComplete,
  StepLink,
  type SetupStep,
} from "@/components/app/setup-checklist";
import { VaultArt } from "@/components/brand/illustrations";
import { Button } from "@/components/ui/button";
import { Card, PageHeader, Stat } from "@/components/ui-kit";
import { CopyField } from "@/components/ui-kit/copy-field";
import { Term } from "@/components/ui-kit/term";
import { currentRound } from "@/lib/rounds";
import { appOrigin } from "@/lib/server/env";
import {
  currentContext,
  getProgramForMember,
  getRounds,
  hasPaidRound,
  recentDecisions,
  submissionCounts,
} from "@/lib/server/queries";
import { shortFromNow } from "@/lib/when";
import { Fragment, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { programSummary } from "@/lib/server/program-summary";
import { programStatusLine } from "@/lib/status-line";
import { JoinPagePreview, NeedsYou, RecentDecisions } from "@/components/app/program-home";
import { CopyButton } from "@/components/ui-kit/copy-button";
import { getOwnerSession, type OwnerSession } from "@/lib/server/session";
import { PublishButton } from "./publish-button";
import { ShareOnX } from "@/components/app/share-on-x";
import { shareOnXUrl } from "@/lib/share";
import { programNameForTitle } from "@/lib/server/titles";
import { submissionRuleRows } from "@/lib/minimums";

export async function generateMetadata({ params }: PageProps<"/app/programs/[id]">) {
  return { title: (await programNameForTitle((await params).id)) ?? "No access" };
}

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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <PageHeader
        title={program.name}
        meta={<ProgramStatus status={program.status} />}
        description={program.description}
        actions={
          <>
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
  const [rounds, counts, recent, paidOnce, context] = await Promise.all([
    getRounds(program.id),
    submissionCounts(program.id),
    recentDecisions(program.id),
    hasPaidRound(program.id),
    currentContext(program.id, program.contextVersion),
  ]);
  const ruleRows = submissionRuleRows({
    minXFollowers: program.minXFollowers,
    minAccountAgeDays: program.minAccountAgeDays,
    belowMinimum: program.belowMinimum,
    maxSubmissionsPerRound: program.maxSubmissionsPerRound,
    mustInclude: context?.mustIncludeJson ?? [],
    acceptsArticles: program.rubricJson.categories.some((c) => c.sourceTypes.includes("article")),
  });
  const total = summary.submissions;
  const limits = program.limitsJson;
  const joinUrl = `${appOrigin()}/join/${program.slug}`;
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
      action: isOwner ? (
        <SetupLink href={`${base}/setup`}>Deploy the vault</SetupLink>
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
        isOwner && vault ? <SetupLink href={`${base}/setup`}>Fund the vault</SetupLink> : null,
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
    {
      key: "first",
      title: "Get a first submission",
      done: total > 0,
      description:
        "Contributors join with your link, sign in with X and paste links to their work. The agent reviews each one in about a minute.",
      doneNote: `${total} so far`,
      action: (
        <section
          aria-labelledby="first-h"
          className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]"
        >
          <div className="grid content-start gap-3">
            <h3 id="first-h" className="sr-only">
              Get your first submissions
            </h3>
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
      ),
    },
    {
      key: "payout",
      title: "Pay the first round",
      done: paidOnce,
      description:
        current?.status === "open" && !summary.round?.scheduled
          ? `Approved work is paid when Round ${current.number} closes, in ${shortFromNow(current.endsAt)}. You can also close it early from Rounds.`
          : "Approved work is paid when the round closes, inside your vault limits.",
      action: <StepLink href={`${base}/rounds`}>Open rounds</StepLink>,
    },
  ];

  // Publishing is allowed at any time: the status bar offers it unless the checklist is already showing it.
  const shareIsNext = steps.findIndex((s) => !s.done) === 2;
  const setupDone = steps.every((s) => s.done);
  const primary = summary.needs[0];
  const line = programStatusLine({
    status: program.status,
    round: summary.round,
    submissions: summary.roundSubmissions,
    readyToPay: summary.readyToPay,
  });

  return (
    <div className="-mt-2 grid grid-cols-[minmax(0,1fr)] gap-10">
      <section
        aria-label="Status"
        className="bg-card shadow-soft relative overflow-hidden rounded-[1.5rem] p-6 sm:p-8"
      >
        <VaultArt className="pointer-events-none absolute top-1/2 right-8 hidden size-36 -translate-y-1/2 md:block" />
        <div className="relative grid gap-5 md:pr-40">
          {setupDone ? (
            <div>
              <SetupComplete />
            </div>
          ) : null}
          <p className="display text-[1.75rem] leading-tight sm:text-[2.25rem]">
            {line[0]}
            {line.length > 1 ? (
              <span className="text-soft block font-sans text-base leading-relaxed sm:text-lg">
                {/* Each phrase stays whole and keeps its separator, so a wrapped line never starts with "·". */}
                {line.slice(1).map((part, i, all) => (
                  <Fragment key={part}>
                    <span className="whitespace-nowrap">
                      {part}
                      {i < all.length - 1 ? " ·" : ""}
                    </span>{" "}
                  </Fragment>
                ))}
              </span>
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {primary && isOwner ? (
              <Button asChild>
                <Link href={primary.href}>{primary.action}</Link>
              </Button>
            ) : null}
            {published ? (
              <>
                <CopyButton value={joinUrl} label="Copy join link" />
                <ShareOnX href={shareHref} />
              </>
            ) : isOwner && !shareIsNext ? (
              <PublishButton programId={program.id} status={program.status} />
            ) : null}
          </div>
        </div>
      </section>

      <SetupChecklist steps={steps} />

      {program.contextVersion === null && program.status !== "archived" ? (
        <p className="bg-card shadow-soft flex flex-wrap items-center justify-between gap-3 rounded-[1.25rem] px-5 py-3.5 text-sm">
          <span>
            <span className="font-medium">Brief the agent.</span>{" "}
            <span className="text-soft">
              Tell it what the project is and what counts; it checks every submission against it.
            </span>
          </span>
          <Link
            href={`/app/programs/${program.id}/settings#context`}
            className="text-brand font-medium underline-offset-4 hover:underline"
          >
            Add context
          </Link>
        </p>
      ) : null}

      {setupDone || summary.needs.length ? <NeedsYou items={summary.needs} /> : null}

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
                ? `USDC from ${approvedUnpaid} approved item${approvedUnpaid === 1 ? "" : "s"}, paid when Round ${current.number} closes`
                : `USDC from ${approvedUnpaid} approved item${approvedUnpaid === 1 ? "" : "s"}`
            }
          />
        </section>
      ) : null}

      <RecentDecisions
        href={`${base}/submissions`}
        items={recent.map((d) => ({ ...d, amount: BigInt(d.amount) }))}
      />

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
        <div className="grid gap-6">
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
                    limits.payeeCooldownSeconds
                      ? `${limits.payeeCooldownSeconds / 3600} hours`
                      : "None",
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
          <Card
            title="Submission rules"
            description="Contributors see these on the join page."
            actions={
              isOwner ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href={`${base}/settings#rules`} aria-label="Edit submission rules">
                    Edit
                  </Link>
                </Button>
              ) : null
            }
          >
            <dl className="grid gap-2.5 text-sm">
              {ruleRows.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right [overflow-wrap:anywhere]">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** The deploy and fund steps open the guided setup flow (full screen, one step at a time). */
function SetupLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button asChild>
      <Link href={href}>
        {children}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </Button>
  );
}
