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
import { utc, utcDay } from "@/lib/time";
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
        className="mx-auto grid w-full max-w-3xl flex-1 grid-cols-[minmax(0,1fr)] gap-8 px-4 py-8 sm:px-6 sm:py-12"
      >
        <div>
          <Link
            href="/c"
            className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Programs you joined
          </Link>
          <p className="text-muted-foreground text-sm">
            {program.name} · @{me.xHandle}
          </p>
          <h1 className="mt-1 text-2xl font-medium tracking-[-0.02em]">Your contributions</h1>
          {round ? (
            <p className="text-soft mt-2 text-sm">
              {roundOpen
                ? `Round ${round.number} ends ${fromNow(round.endsAt)} (${utc(round.endsAt)}). Approved work is paid when it closes.`
                : scheduled
                  ? `Round ${round.number} starts ${fromNow(round.startsAt)} (${utc(round.startsAt)}).`
                  : `Round ${round.number}: ${utcDay(round.startsAt)} to ${utcDay(round.endsAt)}.`}
            </p>
          ) : null}
        </div>

        {program.status === "paused" ? (
          <Notice>This program has paused new sign-ups. You can keep submitting.</Notice>
        ) : null}

        <PayoutWalletBanner expected={me.walletAddress} />

        {!submittedAny ? (
          <section className="bg-card rounded-xl border p-4 sm:p-6" aria-labelledby="next-h">
            <h2 id="next-h" className="font-medium">
              You&apos;re in. Here&apos;s what to do next
            </h2>
            <ol className="mt-4 grid gap-4">
              {contributorNextSteps({
                sources,
                xHandle: me.xHandle,
                githubConnected: !!me.githubUserId,
              }).map((step, i) => (
                <li key={step.title} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums"
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 text-sm leading-relaxed">
                    <p className="font-medium">{step.title}</p>
                    {step.body ? <p className="text-soft">{step.body}</p> : null}
                    {step.items ? (
                      <ul className="text-soft mt-1 grid gap-1">
                        {step.items.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
            <Disclosure
              title="What this program pays for"
              defaultOpen
              className="mt-5 border-t pt-4"
            >
              <ul className="mt-2 grid gap-2 text-sm">
                {program.rubricJson.categories.map((c) => (
                  <li key={c.key} className="rounded-lg border p-3">
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

        <dl
          className="bg-card grid grid-cols-1 divide-y rounded-xl border sm:grid-cols-3 sm:divide-x sm:divide-y-0"
          aria-label="Your totals"
        >
          <div className="p-4">
            <dt className="text-muted-foreground text-xs">Paid to you</dt>
            <dd className="mono-num mt-1 text-xl">{formatUsdc(earned, { withSymbol: false })}</dd>
            <dd className="text-muted-foreground mt-1 text-xs">USDC</dd>
          </div>
          <div className="p-4">
            <dt className="text-muted-foreground text-xs">This round so far</dt>
            <dd className="mono-num mt-1 text-xl">
              {formatUsdc(thisRound, { withSymbol: false })}
            </dd>
            <dd className="text-muted-foreground mt-1 text-xs">
              {roundOpen && round
                ? `USDC approved, round ends ${fromNow(round.endsAt)}`
                : "USDC approved"}
            </dd>
          </div>
          <div className="p-4">
            <dt className="text-muted-foreground text-xs">Approved, not yet paid</dt>
            <dd className="mono-num mt-1 text-xl">{formatUsdc(awaiting, { withSymbol: false })}</dd>
            <dd className="text-muted-foreground mt-1 text-xs">
              {roundOpen && round
                ? `USDC, paid after ${utcDay(round.endsAt)}`
                : "USDC, paid when the round closes"}
            </dd>
          </div>
        </dl>

        <section className="bg-card min-w-0 rounded-xl border p-4 sm:p-6">
          <Submissions
            programSlug={program.slug}
            acceptedSources={[
              ...new Set(program.rubricJson.categories.flatMap((c) => c.sourceTypes)),
            ]}
            roundNumber={roundOpen && round ? round.number : null}
            roundEndsAt={roundOpen && round ? round.endsAt.toISOString() : null}
            verifyBase={`/p/${program.slug}`}
            initial={initialItems}
          />
        </section>

        <section className="grid gap-3">
          <h2 className="font-medium">Payouts</h2>
          {!detail || detail.payouts.length === 0 ? (
            <EmptyState>No payouts yet. Approved work is paid when the round closes.</EmptyState>
          ) : (
            <ul className="bg-card divide-y rounded-xl border text-sm">
              {detail.payouts.map(({ p, roundNumber, roundId }) => (
                <li
                  key={p.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 p-4"
                >
                  <Link
                    href={`/p/${program.slug}/rounds/${roundId}`}
                    className="font-medium hover:underline"
                  >
                    Round {roundNumber} receipt
                  </Link>
                  <span className="mono-num">{formatUsdc(p.amount)}</span>
                  <span className="col-span-2">
                    {p.txHash ? (
                      <HexValue
                        value={p.txHash}
                        label="transaction"
                        href={`${explorer}/tx/${p.txHash}`}
                      />
                    ) : (
                      <span className="text-muted-foreground capitalize">{p.status}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-card grid gap-4 rounded-xl border p-4 sm:p-6">
          <h2 className="font-medium">Account</h2>
          <dl className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-y-3 text-sm">
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
            <dt className="text-muted-foreground">Payout wallet</dt>
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
      </main>
    </>
  );
}
