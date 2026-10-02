import { payouts, getDb, rounds as roundsTable } from "@misthos/db";
import { formatUsdc } from "@misthos/shared";
import { and, eq, sql } from "drizzle-orm";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Address } from "viem";
import { z } from "zod";
import { ProgramStatus } from "@/components/app/program-status";
import { SetupChecklist, StepLink, type SetupStep } from "@/components/app/setup-checklist";
import { Button } from "@/components/ui/button";
import { Card, Notice, PageHeader, Stat } from "@/components/ui-kit";
import { CopyField } from "@/components/ui-kit/copy-field";
import { Term } from "@/components/ui-kit/term";
import { DeployVault } from "@/components/vault/deploy-vault";
import { FundVault } from "@/components/vault/fund-vault";
import { currentRound, recentlyChanged } from "@/lib/rounds";
import { appOrigin } from "@/lib/server/env";
import {
  getProgramForMember,
  getRounds,
  listContributors,
  submissionCounts,
} from "@/lib/server/queries";
import { getOwnerSession } from "@/lib/server/session";
import {
  agentAddress,
  factoryAddress,
  programIdBytes32,
  readVault,
  usdcAddress,
} from "@/lib/server/vault";
import { utcDay } from "@/lib/time";
import { PublishButton } from "./publish-button";

export default async function ProgramPage({ params }: PageProps<"/app/programs/[id]">) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const row = await getProgramForMember(id, session.sub);
  if (!row) notFound();
  const { program, role } = row;
  const isOwner = role === "owner";
  const [rounds, contributors, counts, [paid]] = await Promise.all([
    getRounds(program.id),
    listContributors(program.id),
    submissionCounts(program.id),
    getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(payouts)
      .innerJoin(roundsTable, eq(roundsTable.id, payouts.roundId))
      .where(and(eq(roundsTable.programId, program.id), eq(payouts.status, "executed"))),
  ]);
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const limits = program.limitsJson;
  const joinUrl = `${appOrigin()}/join/${program.slug}`;
  const agent = agentAddress();
  const vault = program.vaultAddress as Address | null;
  const vaultState = vault ? await readVault(vault).catch(() => null) : null;
  const awaiting = rounds.filter(
    (r) =>
      r.status === "proposed" &&
      vaultState &&
      r.totalAmount > vaultState.limits.autoApproveThreshold,
  );
  const recentPayeeChanges = recentlyChanged(contributors, limits.payeeCooldownSeconds);
  const current = currentRound(rounds);
  const published = program.status === "active" || program.status === "paused";
  const needsReview = counts.escalated ?? 0;
  const approvedUnpaid = (counts.approved ?? 0) + (counts.partial ?? 0);
  const base = `/app/programs/${program.id}`;

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
      done: published && contributors.length > 0,
      description: published
        ? "The join page is open. Send this link to your contributors; they sign in with X and link a payout wallet."
        : "Open the join page, then send the link to your contributors.",
      doneNote: `${contributors.length} contributor${contributors.length === 1 ? "" : "s"} joined.`,
      action: (
        <div className="grid max-w-xl gap-3">
          {published ? (
            <CopyField
              value={joinUrl}
              label="join link"
              display={joinUrl.replace(/^https?:\/\//, "")}
            />
          ) : null}
          {isOwner && !published ? (
            <PublishButton programId={program.id} status={program.status} size="default" />
          ) : null}
          {published ? (
            <p className="text-muted-foreground text-xs">
              This step completes when the first contributor joins.
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "submission",
      title: "Receive the first submission",
      done: total > 0,
      description:
        "Contributors paste links to their work. The agent reviews each one in about a minute.",
      doneNote: `${total} submission${total === 1 ? "" : "s"} so far.`,
      action: <StepLink href={`${base}/submissions`}>Open submissions</StepLink>,
    },
    {
      key: "payout",
      title: "Send the first payout",
      done: (paid?.n ?? 0) > 0,
      description: current
        ? `Approved work is paid when round ${current.number} closes on ${utcDay(current.endsAt)}, or close it early from Rounds.`
        : "Approved work is paid when the round closes.",
      action: <StepLink href={`${base}/rounds`}>Go to rounds</StepLink>,
    },
  ];

  return (
    <div className="grid gap-8">
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
            {isOwner && published ? (
              <PublishButton programId={program.id} status={program.status} />
            ) : null}
          </>
        }
      />

      {awaiting.map((r) => (
        <Notice key={r.id}>
          <Link href={`${base}/rounds/${r.id}`} className="underline underline-offset-4">
            Round {r.number} ({formatUsdc(r.totalAmount)}) is waiting for your approval.
          </Link>
        </Notice>
      ))}
      {recentPayeeChanges.length ? (
        <Notice>
          Payout wallet changed recently:{" "}
          {recentPayeeChanges.map((c) => `@${c.xHandle}`).join(", ")}. The vault won&apos;t pay a
          new wallet until its <Term k="cooldown">cooldown</Term> ends; check this was really them.
        </Notice>
      ) : null}

      <SetupChecklist steps={steps} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Program totals">
        <Stat
          label="Vault balance"
          value={vaultState ? formatUsdc(vaultState.balance, { withSymbol: false }) : "—"}
          hint={vaultState ? "USDC" : "Vault not deployed"}
        />
        <Stat
          label="Contributors"
          value={contributors.length}
          hint={published ? "Joined" : "Join page not open"}
        />
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
          label={current ? `Round ${current.number}` : "Round"}
          value={approvedUnpaid}
          hint={current ? `approved, paid after ${utcDay(current.endsAt)}` : "approved, unpaid"}
        />
      </section>

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
