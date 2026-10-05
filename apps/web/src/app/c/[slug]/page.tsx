import { ArrowLeft } from "lucide-react";
import { formatUsdc, Slug } from "@misthos/shared";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/app/sign-out-button";
import { SiteHeader } from "@/components/app/site-header";
import { ChangeWallet, PayoutWalletBanner } from "@/components/contributor/wallet-islands";
import { GithubConnect } from "@/components/contributor/github-connect";
import { Disclosure } from "@/components/ui-kit/disclosure";
import { contributorNextSteps } from "@/lib/contributor-steps";
import { Submissions } from "@/components/contributor/submissions";
import { HexValue } from "@/components/hex-value";
import { EmptyState, Notice } from "@/components/ui-kit";
import { cooldownEndsAt, currentRound, isScheduled } from "@/lib/rounds";
import { chainConfig } from "@/lib/server/chain";
import { contributorDetail } from "@/lib/server/contributors-view";
import { contributorSubmissionItems } from "@/lib/server/contributor-submissions";
import { getContributorMembership, getProgramBySlug, getRounds } from "@/lib/server/queries";
import { getContributorSession } from "@/lib/server/session";
import { shortUtc, utc, utcDay } from "@/lib/time";
import { contributorTimeline } from "@/lib/contributor-timeline";
import { CoinsArt } from "@/components/brand/illustrations";
import { Stepper } from "@/components/ui-kit/stepper";
import { fromNow } from "@/lib/when";

export const metadata = { title: "Your contributions" };

export default async function ContributorHome({ params, searchParams }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const parsed = Slug.safeParse(slug);
  if (!parsed.success) notFound();
  const program = await getProgramBySlug(parsed.data);
  if (!program) notFound();
  const session = await getContributorSession();
  if (!session) redirect(`/join/${program.slug}?return=dashboard`);
  const me = await getContributorMembership(program.id, session.xid);
  if (!me) redirect(`/join/${program.slug}`);

  const cooldownSeconds = program.limitsJson.payeeCooldownSeconds;
  const cooldownEnds = cooldownEndsAt(me.walletChangedAt, cooldownSeconds);
  const [detail, rounds, initialItems] = await Promise.all([
    contributorDetail(program.id, me.id),
    getRounds(program.id),
    contributorSubmissionItems(me.id),
  ]);
  const round = currentRound(rounds);
  const scheduled = round ? isScheduled(round) : false;
  const roundOpen = round && round.status === "open" && !scheduled;
  const earned =
    detail?.payouts.filter((p) => p.p.status === "executed").reduce((s, p) => s + p.p.amount, 0n) ??
    0n;
  const awaiting =
    detail?.submissions
      .filter((s) => s.status === "approved" || s.status === "partial")
      .reduce((sum, s) => sum + (s.amount ?? 0n), 0n) ?? 0n;
  const explorer = chainConfig().explorerUrl;
  const thisRound =
    roundOpen && round
      ? (detail?.submissions ?? [])
          .filter(
            (x) => x.roundId === round.id && ["approved", "partial", "paid"].includes(x.status),
          )
          .reduce((sum, x) => sum + (x.amount ?? 0n), 0n)
      : 0n;
  const submittedAny = (detail?.submissions.length ?? 0) > 0;
  const sources = [...new Set(program.rubricJson.categories.flatMap((c) => c.sourceTypes))];

  const timeline = contributorTimeline({
    joinedAt: me.createdAt,
    programName: program.name,
    walletLinkedAt: me.walletAddress ? (me.walletVerifiedAt ?? me.createdAt) : null,
    githubVerifiedAt: me.githubUserId ? (me.githubVerifiedAt ?? me.createdAt) : null,
    paysGithub: sources.some((t) => t === "github_pr" || t === "github_commit"),
    submissions: (detail?.submissions ?? []).map((x) => ({
      createdAt: x.createdAt,
      status: x.status,
      decidedAt: x.decision?.createdAt ?? null,
    })),
    payouts: (detail?.payouts ?? []).map(({ p, roundNumber }) => ({
      amount: p.amount,
      status: p.status,
      at: p.updatedAt,
      roundNumber,
    })),
    round: round ? { number: round.number, endsAt: round.endsAt, open: !!roundOpen } : null,
    awaiting,
  });

  return (
    <>
      <SiteHeader
        right={
          <>
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/c">Your programs</Link>
            </Button>
            <SignOutButton kind="contributor" />
          </>
        }
      />
      <main
        id="main"
        className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-[minmax(0,1fr)] gap-8 px-4 py-8 sm:px-6 sm:py-12"
      >
        <div>
          <Link
            href="/c"
            className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Programs you joined
          </Link>
          <p className="text-muted-foreground text-sm">
            {program.name} · @{me.xHandle}
          </p>
          <h1 className="display mt-1 text-[2.5rem] leading-[1.05] sm:text-[3.25rem]">
            Your <em>contributions</em>
          </h1>
          {round ? (
            <p className="mt-4">
              <span className="bg-card shadow-soft inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm">
                <span
                  aria-hidden="true"
                  className={`size-2 rounded-full ${roundOpen ? "bg-brand" : "bg-muted-foreground/50"}`}
                />
                {roundOpen
                  ? `Round ${round.number} ends ${fromNow(round.endsAt)}`
                  : scheduled
                    ? `Round ${round.number} starts ${fromNow(round.startsAt)}`
                    : `Round ${round.number}: ${utcDay(round.startsAt)} to ${utcDay(round.endsAt)}`}
                <span className="text-muted-foreground hidden sm:inline">
                  · {utc(roundOpen ? round.endsAt : round.startsAt)}
                </span>
              </span>
            </p>
          ) : null}
        </div>

        {program.status === "paused" ? (
          <Notice>This program has paused new sign-ups. You can keep submitting.</Notice>
        ) : null}

        <PayoutWalletBanner expected={me.walletAddress} />

        <section
          aria-label="Your earnings"
          className="bg-card shadow-lift relative overflow-hidden rounded-[1.5rem] p-6 sm:p-8"
        >
          <CoinsArt className="pointer-events-none absolute right-6 bottom-4 hidden size-32 md:block" />
          <dl className="relative grid gap-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] md:pr-36">
            <div>
              <dt className="text-muted-foreground text-sm">Paid to you</dt>
              <dd className="display mt-1 text-[3.5rem] leading-none tabular-nums sm:text-[4.25rem]">
                {formatUsdc(earned, { withSymbol: false })}
              </dd>
              <dd className="text-muted-foreground mt-2 text-xs">USDC on Arc</dd>
            </div>
            <div className="md:border-l md:pl-6">
              <dt className="text-muted-foreground text-sm">This round so far</dt>
              <dd className="display mt-1 text-[2rem] leading-none tabular-nums">
                {formatUsdc(thisRound, { withSymbol: false })}
              </dd>
              <dd className="text-muted-foreground mt-2 text-xs leading-relaxed">
                {roundOpen && round
                  ? `USDC approved, round ends ${fromNow(round.endsAt)}`
                  : "USDC approved"}
              </dd>
            </div>
            <div className="md:border-l md:pl-6">
              <dt className="text-muted-foreground text-sm">Approved, not yet paid</dt>
              <dd className="display mt-1 text-[2rem] leading-none tabular-nums">
                {formatUsdc(awaiting, { withSymbol: false })}
              </dd>
              <dd className="text-muted-foreground mt-2 text-xs leading-relaxed">
                {roundOpen && round
                  ? `USDC, paid after ${utcDay(round.endsAt)}`
                  : "USDC, paid when the round closes"}
              </dd>
            </div>
          </dl>
        </section>

        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid min-w-0 gap-8">
            {!submittedAny ? (
              <section
                className="bg-brand-subtle/60 rounded-[1.5rem] p-6 sm:p-8"
                aria-labelledby="next-h"
              >
                <h2 id="next-h" className="display text-[1.75rem] leading-tight">
                  You&apos;re in. Here&apos;s what to do next
                </h2>
                <Stepper
                  className="mt-5"
                  label="Getting started"
                  steps={contributorNextSteps({
                    sources,
                    xHandle: me.xHandle,
                    githubConnected: !!me.githubUserId,
                  }).map((step, i) => ({
                    key: step.title,
                    label: step.title,
                    status: i === 0 ? "current" : "waiting",
                    detail: (
                      <>
                        {step.body ? <span className="block">{step.body}</span> : null}
                        {step.items ? (
                          <ul className="mt-1 grid gap-1">
                            {step.items.map((t) => (
                              <li key={t}>{t}</li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    ),
                  }))}
                />
                <Disclosure
                  title="What this program pays for"
                  defaultOpen
                  className="border-foreground/10 mt-6 border-t pt-4"
                >
                  <ul className="mt-2 grid gap-2 text-sm">
                    {program.rubricJson.categories.map((c) => (
                      <li key={c.key} className="bg-card rounded-xl p-3.5">
                        <span className="flex justify-between gap-3">
                          <span className="font-medium">{c.name}</span>
                          <span className="mono-num shrink-0">
                            up to {formatUsdc(program.ratePerPoint * BigInt(c.maxPoints))}
                          </span>
                        </span>
                        <span className="text-muted-foreground mt-0.5 block">{c.description}</span>
                        <span className="text-muted-foreground block text-xs">
                          Scored on {c.criteria.map((k) => k.name.toLowerCase()).join(", ")}
                        </span>
                        {c.rules ? <span className="mt-1 block">{c.rules}</span> : null}
                      </li>
                    ))}
                  </ul>
                  {program.rubricJson.generalRules ? (
                    <p className="text-soft mt-2 text-sm whitespace-pre-line">
                      {program.rubricJson.generalRules}
                    </p>
                  ) : null}
                </Disclosure>
              </section>
            ) : null}

            <section className="bg-card shadow-soft min-w-0 rounded-[1.5rem] p-5 sm:p-7">
              <Submissions
                programSlug={program.slug}
                acceptedSources={sources}
                roundNumber={roundOpen && round ? round.number : null}
                roundEndsAt={roundOpen && round ? round.endsAt.toISOString() : null}
                verifyBase={`/p/${program.slug}`}
                initial={initialItems}
              />
            </section>

            <section className="grid gap-4" aria-labelledby="earnings-h">
              <div>
                <h2 id="earnings-h" className="display text-[1.75rem] leading-tight">
                  Earnings
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Every payout is a public transaction on Arc with a receipt.
                </p>
              </div>
              {!detail || detail.payouts.length === 0 ? (
                <EmptyState art="coins" title="No payouts yet">
                  Approved work is paid when the round closes.
                  {awaiting > 0n ? ` ${formatUsdc(awaiting)} is approved and waiting.` : ""}
                </EmptyState>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {detail.payouts.map(({ p, roundNumber, roundId }) => (
                    <li
                      key={p.id}
                      className="bg-card shadow-soft grid gap-3 rounded-[1.25rem] p-5 text-sm"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <Link
                          href={`/p/${program.slug}/rounds/${roundId}`}
                          className="font-medium hover:underline"
                        >
                          Round {roundNumber} receipt
                        </Link>
                        <span className="display text-[1.5rem] leading-none tabular-nums">
                          {formatUsdc(p.amount, { withSymbol: false })}
                          <span className="text-muted-foreground ml-1 font-sans text-xs">USDC</span>
                        </span>
                      </div>
                      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
                        {p.txHash ? (
                          <HexValue
                            value={p.txHash}
                            label="transaction"
                            href={`${explorer}/tx/${p.txHash}`}
                          />
                        ) : (
                          <span className="capitalize">{p.status}</span>
                        )}
                        <span>{utcDay(p.updatedAt)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="grid gap-6 lg:sticky lg:top-6">
            <section
              aria-labelledby="timeline-h"
              className="bg-card shadow-soft rounded-[1.5rem] p-5 sm:p-6"
            >
              <h2 id="timeline-h" className="display text-[1.5rem] leading-tight">
                Your timeline
              </h2>
              <Stepper
                className="mt-5"
                size="sm"
                label="Your milestones"
                steps={timeline.map((t) => ({
                  key: t.key,
                  label: t.label,
                  status: t.state,
                  meta: t.at ? (t.state === "waiting" ? shortUtc(t.at) : utcDay(t.at)) : undefined,
                  detail: t.detail,
                }))}
              />
            </section>

            <section className="bg-card shadow-soft grid gap-4 rounded-[1.5rem] p-5 sm:p-6">
              <h2 className="display text-[1.5rem] leading-tight">Account</h2>
              <dl className="grid grid-cols-[90px_minmax(0,1fr)] items-baseline gap-y-3 text-sm">
                <dt className="text-muted-foreground">X</dt>
                <dd>@{me.xHandle}</dd>
                <dt className="text-muted-foreground">GitHub</dt>
                <dd>
                  <GithubConnect
                    slug={program.slug}
                    login={me.githubLogin}
                    verified={!!me.githubUserId}
                    status={typeof sp.github === "string" ? sp.github : undefined}
                    error={typeof sp.github_error === "string" ? sp.github_error : undefined}
                  />
                </dd>
                <dt className="text-muted-foreground">Wallet</dt>
                <dd>
                  {me.walletAddress ? (
                    <HexValue
                      value={me.walletAddress}
                      label="payout wallet"
                      href={`${explorer}/address/${me.walletAddress}`}
                    />
                  ) : (
                    "Not linked"
                  )}
                </dd>
              </dl>
              {cooldownEnds ? (
                <Notice>
                  You changed your wallet recently. For your safety, payouts to it start after{" "}
                  {utc(cooldownEnds)}.
                </Notice>
              ) : null}
              <div>
                <ChangeWallet
                  programSlug={program.slug}
                  cooldownHours={cooldownSeconds / 3600}
                  currentWallet={me.walletAddress}
                />
              </div>
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
